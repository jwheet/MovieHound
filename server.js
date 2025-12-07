const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');
const xml2js = require('xml2js');

const app = express();
const PORT = 8321;
const TMDB_API_KEY = 'YOUR-API-KEY';

app.use(express.json());
app.use(express.static('public'));

// Storage files
const GLOBAL_IDS_FILE = 'global_movie_ids.json';
const HISTORY_FILE = 'history.json';
const LISTS_DIR = 'movie_lists';
const TORRENT_LISTS_DIR = 'torrent_lists';
const TORRENT_HISTORY_FILE = 'torrent_history.json';

// YTS API configuration
const YTS_API_BASE = 'https://yts.lt/api/v2';
const YTS_TRACKERS = [
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.coppersurfer.tk:6969',
    'udp://glotorrents.pw:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://torrent.gresille.org:80/announce',
    'udp://p4p.arenabg.com:1337',
    'udp://tracker.leechers-paradise.org:6969'
];

// Background job queue for refresh searches
const activeRefreshJobs = new Map();

// Background worker function for processing refresh jobs
async function processRefreshJob(jobId) {
    const job = activeRefreshJobs.get(jobId);
    if (!job) {
        console.log(`Job ${jobId} not found`);
        return;
    }

    try {
        const { errorsFilename, resultsFilename, quality, forceQuality } = job;

        // Read error file
        const errorsPath = path.join(TORRENT_LISTS_DIR, errorsFilename);
        const errorsContent = await fs.readFile(errorsPath, 'utf8');
        const errorLines = errorsContent.split('\n').slice(1); // Skip header

        // Filter valid lines
        const validLines = errorLines.filter(line =>
            line.trim() && !line.startsWith('MANUAL')
        );

        job.total = validLines.length;
        job.processed = 0;
        job.newlyFound = 0;
        job.stillMissing = 0;

        let stillMissing = [];
        let newlyFound = [];
        let additionalSizeBytes = 0;

        for (const line of validLines) {
            // Check if job was cancelled
            if (!activeRefreshJobs.has(jobId)) {
                console.log(`Job ${jobId} was cancelled`);
                return;
            }

            const parts = line.split('\t');
            if (parts.length < 5) continue;

            const title = parts[1];
            const imdbId = parts[2] !== 'N/A' ? parts[2] : null;
            const tmdbId = parseInt(parts[3]);
            const year = parts[4];

            job.current = title;

            let selectedTorrent = null;
            let magnetLink = null;
            let fallbackUsed = null;

            // TIER 1: Try YTS API
            if (imdbId) {
                const ytsMovie = await searchYtsTorrents(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (ytsMovie && ytsMovie.torrents && ytsMovie.torrents.length > 0) {
                    selectedTorrent = selectBestTorrent(ytsMovie.torrents, quality, forceQuality);
                    if (selectedTorrent) {
                        magnetLink = constructMagnetLink(
                            selectedTorrent.hash,
                            `${title} ${year} ${selectedTorrent.quality}`
                        );
                        fallbackUsed = 'YTS_API';
                    }
                }
            }

            // TIER 2: Try YTS page scraping
            if (!selectedTorrent && imdbId) {
                const imdbInfo = await getImdbMovieInfo(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (imdbInfo) {
                    const ytsTorrents = await scrapeYtsMovie(imdbInfo.title, imdbInfo.year);
                    await new Promise(resolve => setTimeout(resolve, 300));

                    if (ytsTorrents && ytsTorrents.length > 0) {
                        selectedTorrent = ytsTorrents.find(t => t.quality === quality);
                        if (!selectedTorrent && !forceQuality) selectedTorrent = ytsTorrents[0];

                        if (selectedTorrent) {
                            magnetLink = selectedTorrent.magnetLink;
                            fallbackUsed = 'YTS_SCRAPE';
                        }
                    }
                }
            }

            // TIER 3: Try Torrent-Api-py multiple sites
            if (!selectedTorrent) {
                let searchTitle = title;
                let searchYear = year;

                if (imdbId) {
                    const imdbInfo = await getImdbMovieInfo(imdbId);
                    if (imdbInfo) {
                        searchTitle = imdbInfo.title;
                        searchYear = imdbInfo.year;
                    }
                }

                const apiResult = await searchTorrentApiPy(searchTitle, searchYear, quality);
                await new Promise(resolve => setTimeout(resolve, 500));

                if (apiResult) {
                    selectedTorrent = apiResult;
                    magnetLink = apiResult.magnetLink;
                    fallbackUsed = `API_${apiResult.source.toUpperCase()}`;
                }
            }

            // Categorize result and ADD LIVE TO RESULTS
            if (selectedTorrent && magnetLink) {
                const foundMovie = {
                    tmdbId,
                    imdbId: imdbId || 'N/A',
                    title,
                    year,
                    quality: selectedTorrent.quality,
                    size: selectedTorrent.size || 'Unknown',
                    magnetLink,
                    source: fallbackUsed
                };

                newlyFound.push(foundMovie);
                job.newlyFound++;

                if (selectedTorrent.size) {
                    additionalSizeBytes += sizeToBytes(selectedTorrent.size);
                }

                // IMMEDIATELY add to results file (LIVE UPDATE)
                const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);
                const newLine = `${foundMovie.title}\t${foundMovie.magnetLink}\t${foundMovie.title}\t${foundMovie.imdbId}\t${foundMovie.tmdbId}\t${foundMovie.year}\t${foundMovie.quality}\t${foundMovie.size}`;
                await fs.appendFile(resultsPath, '\n' + newLine);

                // IMMEDIATELY remove from error list (LIVE UPDATE)
                const currentErrorsContent = await fs.readFile(errorsPath, 'utf8');
                const currentErrorsLines = currentErrorsContent.split('\n');
                const errorsHeader = currentErrorsLines[0];
                const errorsData = currentErrorsLines.slice(1).filter(l => l.trim());

                // Remove this specific movie from errors
                const updatedErrors = errorsData.filter(errorLine => {
                    const errorParts = errorLine.split('\t');
                    if (errorParts.length >= 5) {
                        const eTmdbId = errorParts[3];
                        const eYear = errorParts[4];
                        return !(eTmdbId === String(tmdbId) && eYear === year);
                    }
                    return true;
                });

                stillMissing = updatedErrors;

                // Write updated errors immediately
                const newErrorsContent = errorsHeader + '\n' + updatedErrors.join('\n');
                await fs.writeFile(errorsPath, newErrorsContent);
            } else {
                stillMissing.push(line);
                job.stillMissing++;
            }

            // Update job progress
            job.processed++;
        }

        // Files already updated live, just need final cleanup

        // Update errors file
        const errorsHeader = 'Status\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tError\n';
        const finalErrorsContent = errorsHeader + stillMissing.join('\n');
        await fs.writeFile(errorsPath, finalErrorsContent);

        // Update history with new size
        const history = await loadTorrentHistory();
        const entry = history.find(h => h.resultsFilename === resultsFilename);
        if (entry) {
            entry.successCount += newlyFound.length;
            entry.errorCount = stillMissing.length;
            entry.totalSizeBytes = (entry.totalSizeBytes || 0) + additionalSizeBytes;
            entry.totalSize = formatBytes(entry.totalSizeBytes);
            await saveTorrentHistory(history);
        }

        // Mark job as completed
        job.status = 'completed';
        job.endTime = Date.now();
        job.additionalSize = formatBytes(additionalSizeBytes);
        job.newTotalSize = entry ? entry.totalSize : 'Unknown';

        console.log(`Job ${jobId} completed: ${job.newlyFound} found, ${job.stillMissing} still missing`);

        // Cleanup after 5 minutes
        setTimeout(() => {
            activeRefreshJobs.delete(jobId);
            console.log(`Job ${jobId} cleaned up`);
        }, 300000);

    } catch (error) {
        console.error(`Error in job ${jobId}:`, error);
        job.status = 'error';
        job.error = error.message;
        job.endTime = Date.now();
    }
}

// Download clients configuration
const DOWNLOAD_CLIENTS_FILE = 'download_clients.json';
const crypto = require('crypto');

// Encryption key for passwords (in production, use environment variable)
const ENCRYPTION_KEY = crypto.randomBytes(32);
const ENCRYPTION_IV_LENGTH = 16;

// Client configurations
const CLIENT_CONFIGS = {
    qbittorrent: {
        name: 'qBittorrent',
        defaultPort: 8080,
        authMethod: 'cookie',
        supportsCategories: true,
        supportsRenameOnAdd: true,
        implemented: true,
        logo: '/logos/qbittorrent.png',
        api: 'rest'
    },
    transmission: {
        name: 'Transmission',
        defaultPort: 9091,
        authMethod: 'basic+session',
        supportsCategories: false,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/transmission.png',
        api: 'json-rpc'
    },
    deluge: {
        name: 'Deluge',
        defaultPort: 8112,
        authMethod: 'password',
        supportsCategories: true,
        supportsRenameOnAdd: true,
        implemented: true,
        logo: '/logos/deluge.png',
        api: 'json-rpc'
    },
    biglybt: {
        name: 'BiglyBT',
        defaultPort: 9091,
        authMethod: 'basic+session',
        supportsCategories: true,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/biglybt.png',
        api: 'json-rpc'
    },
    vuze: {
        name: 'Vuze',
        defaultPort: 9091,
        authMethod: 'basic+session',
        supportsCategories: true,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/vuze.png',
        api: 'json-rpc'
    },
    tribler: {
        name: 'Tribler',
        defaultPort: 8085,
        authMethod: 'apikey',
        supportsCategories: false,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/tribler.png',
        api: 'rest'
    },
    utorrent: {
        name: 'uTorrent',
        defaultPort: 8080,
        authMethod: 'basic',
        supportsCategories: true,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/utorrent.png',
        api: 'webui'
    },
    rtorrent: {
        name: 'rTorrent',
        defaultPort: 80,
        authMethod: 'basic',
        supportsCategories: false,
        supportsRenameOnAdd: true,
        implemented: true,
        logo: '/logos/rtorrent.png',
        api: 'xml-rpc'
    },
    tixati: {
        name: 'Tixati',
        defaultPort: 8888,
        authMethod: 'basic',
        supportsCategories: true,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/tixati.png',
        api: 'web'
    },
    aria2: {
        name: 'Aria2',
        defaultPort: 6800,
        authMethod: 'token',
        supportsCategories: false,
        supportsRenameOnAdd: false,
        implemented: true,
        logo: '/logos/aria2.png',
        api: 'json-rpc'
    }
};

// Initialize storage
async function initStorage() {
    try {
        await fs.access(GLOBAL_IDS_FILE);
    } catch {
        await fs.writeFile(GLOBAL_IDS_FILE, JSON.stringify([]));
    }

    try {
        await fs.access(HISTORY_FILE);
    } catch {
        await fs.writeFile(HISTORY_FILE, JSON.stringify([]));
    }

    try {
        await fs.access(LISTS_DIR);
    } catch {
        await fs.mkdir(LISTS_DIR);
    }

    try {
        await fs.access(TORRENT_LISTS_DIR);
    } catch {
        await fs.mkdir(TORRENT_LISTS_DIR);
    }

    try {
        await fs.access(TORRENT_HISTORY_FILE);
    } catch {
        await fs.writeFile(TORRENT_HISTORY_FILE, JSON.stringify([]));
    }

    try {
        await fs.access(DOWNLOAD_CLIENTS_FILE);
    } catch {
        await fs.writeFile(DOWNLOAD_CLIENTS_FILE, JSON.stringify([]));
    }

    try {
        await fs.access('public/logos');
    } catch {
        await fs.mkdir('public/logos', { recursive: true });
    }
}

// Load global movie IDs
async function loadGlobalIds() {
    const data = await fs.readFile(GLOBAL_IDS_FILE, 'utf8');
    return new Set(JSON.parse(data));
}

// Save global movie IDs
async function saveGlobalIds(ids) {
    await fs.writeFile(GLOBAL_IDS_FILE, JSON.stringify([...ids]));
}

// Load history
async function loadHistory() {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
}

// Save history
async function saveHistory(history) {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Check if movie has non-theatrical releases (digital, physical, TV)
async function hasNonTheatricalRelease(movieId) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}/release_dates`, {
            params: {
                api_key: TMDB_API_KEY
            }
        });

        // Check all regions for release types 4 (Digital), 5 (Physical), or 6 (TV)
        for (const region of response.data.results) {
            for (const release of region.release_dates) {
                if (release.type === 4 || release.type === 5 || release.type === 6) {
                    return true; // Has digital, physical, or TV release
                }
            }
        }
        return false; // Only has theatrical releases
    } catch (error) {
        console.error(`Error checking release dates for movie ${movieId}:`, error.message);
        return false; // On error, exclude the movie to be safe
    }
}

// Fetch popular movies from TMDB
async function fetchPopularMovies(language, page) {
    try {
        const params = {
            api_key: TMDB_API_KEY,
            with_original_language: language,
            sort_by: 'popularity.desc',
            page: page
        };

        const response = await axios.get('https://api.themoviedb.org/3/discover/movie', {
            params: params
        });

        const totalPages = response.data.total_pages;
        const totalResults = response.data.total_results;

        console.log(`[FETCH-MOVIES] Page ${page}/${totalPages}: Got ${response.data.results.length} results (Total available: ${totalResults})`);

        // Check if we've reached the end of available results
        if (response.data.results.length === 0) {
            console.log(`[FETCH-MOVIES] No more results available at page ${page}`);
        }

        return response.data.results.map(movie => movie.id);
    } catch (error) {
        console.error(`Error fetching page ${page}:`, error.message);
        return [];
    }
}

// Torrent conversion helper functions

// Get movie details (title and year) from TMDB
async function getMovieDetails(tmdbId) {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
            params: { api_key: TMDB_API_KEY }
        });
        return {
            title: response.data.title,
            year: response.data.release_date ? response.data.release_date.split('-')[0] : 'Unknown'
        };
    } catch (error) {
        console.error(`Error fetching details for movie ${tmdbId}:`, error.message);
        return null;
    }
}

// Get IMDB ID from TMDB movie ID
async function getImdbId(tmdbId) {
    try {
        const response = await axios.get(
            `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids`,
            { params: { api_key: TMDB_API_KEY } }
        );
        return response.data.imdb_id || null;
    } catch (error) {
        console.error(`Error fetching IMDB ID for TMDB ${tmdbId}:`, error.message);
        return null;
    }
}

// Search YTS for torrents by IMDB ID
async function searchYtsTorrents(imdbId) {
    try {
        const response = await axios.get(`${YTS_API_BASE}/list_movies.json`, {
            params: { query_term: imdbId },
            timeout: 10000
        });

        if (response.data.status === 'ok' &&
            response.data.data.movie_count > 0) {
            return response.data.data.movies[0];
        }
        return null;
    } catch (error) {
        console.error(`Error searching YTS for ${imdbId}:`, error.message);
        return null;
    }
}

// Select best torrent based on quality preference
function selectBestTorrent(torrents, preferredQuality = '1080p', forceQuality = false) {
    if (!torrents || torrents.length === 0) return null;

    // If force quality is enabled, only return exact match
    if (forceQuality) {
        const exactMatch = torrents.find(t => t.quality === preferredQuality);
        return exactMatch || null; // Return null if exact quality not found
    }

    // Quality preference order (with fallback)
    const qualityPriority = {
        '2160p': ['2160p', '1080p', '720p', '480p', '3D'],
        '1080p': ['1080p', '720p', '480p', '2160p', '3D'],
        '720p': ['720p', '480p', '1080p', '2160p', '3D'],
        '480p': ['480p', '720p', '1080p', '2160p', '3D']
    };

    const priority = qualityPriority[preferredQuality] || qualityPriority['1080p'];

    for (const quality of priority) {
        const torrent = torrents.find(t => t.quality === quality);
        if (torrent) return torrent;
    }

    return torrents[0]; // Fallback to first available
}

// Construct magnet link from torrent hash and title
function constructMagnetLink(hash, title) {
    const encodedTitle = encodeURIComponent(title);
    const trackerParams = YTS_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
    return `magnet:?xt=urn:btih:${hash}&dn=${encodedTitle}${trackerParams}`;
}

// Get IMDB movie info (title and year) from IMDB ID
async function getImdbMovieInfo(imdbId) {
    try {
        const response = await axios.get(`https://www.imdb.com/title/${imdbId}/`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Safely load HTML with cheerio
        let $;
        try {
            $ = cheerio.load(response.data);
        } catch (cheerioError) {
            console.error(`[CHEERIO ERROR] Failed to parse HTML for IMDB ${imdbId}:`, {
                error: cheerioError.message,
                name: cheerioError.name,
                responseLength: response.data?.length || 0
            });
            return null;
        }

        // Try to extract title and year from JSON-LD data
        const scriptTag = $('script[type="application/ld+json"]').first().html();
        if (scriptTag) {
            try {
                const data = JSON.parse(scriptTag);
                const title = data.name;
                const year = data.datePublished ? data.datePublished.split('-')[0] : null;

                if (title && year) {
                    return { title, year };
                }
            } catch (jsonError) {
                console.error(`[JSON PARSE ERROR] Failed to parse JSON-LD for IMDB ${imdbId}:`, {
                    error: jsonError.message,
                    scriptLength: scriptTag.length
                });
                // Continue to fallback method
            }
        }

        // Fallback: extract from title tag
        const pageTitle = $('title').text();
        const match = pageTitle.match(/^(.+?)\s*\((\d{4})\)/);
        if (match) {
            return {
                title: match[1].trim(),
                year: match[2]
            };
        }

        return null;
    } catch (error) {
        console.error(`[IMDB FETCH ERROR] Error fetching IMDB info for ${imdbId}:`, {
            error: error.message,
            name: error.name,
            code: error.code
        });
        return null;
    }
}

// Scrape YTS movie page for torrents
async function scrapeYtsMovie(title, year) {
    try {
        // Format movie name for URL: "The Lorax" -> "the-lorax"
        const urlTitle = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Remove special chars
            .replace(/\s+/g, '-')         // Replace spaces with hyphens
            .replace(/-+/g, '-')          // Remove multiple hyphens
            .replace(/^-+|-+$/g, '');     // Remove leading/trailing hyphens

        const url = `https://yts.lt/movies/${urlTitle}-${year}`;
        console.log(`Scraping YTS: ${url}`);

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Safely load HTML with cheerio
        let $;
        try {
            $ = cheerio.load(response.data);
        } catch (cheerioError) {
            console.error(`[CHEERIO ERROR] Failed to parse HTML for YTS ${title} (${year}):`, {
                error: cheerioError.message,
                name: cheerioError.name,
                responseLength: response.data?.length || 0,
                url: url
            });
            return null;
        }

        // Extract all magnet links with quality info
        const torrents = [];

        $('a.magnet-download').each((i, elem) => {
            const magnetLink = $(elem).attr('href');
            const title = $(elem).attr('title');

            // Extract quality from title (e.g., "Download The Lorax 1080p Magnet")
            const qualityMatch = title.match(/(\d+p|3D|2160p)/i);
            const quality = qualityMatch ? qualityMatch[1] : 'Unknown';

            torrents.push({
                quality: quality,
                hash: magnetLink.match(/btih:([A-F0-9]+)/i)[1],
                magnetLink: magnetLink
            });
        });

        // Extract file sizes
        const sizes = [];
        $('.tech-spec-element').each((i, elem) => {
            const text = $(elem).text();
            if (text.includes('GB') || text.includes('MB')) {
                const sizeMatch = text.match(/([\d.]+\s*(?:GB|MB))/i);
                if (sizeMatch) {
                    sizes.push(sizeMatch[1].trim());
                }
            }
        });

        // Match sizes to torrents
        torrents.forEach((torrent, i) => {
            if (sizes[i]) {
                torrent.size = sizes[i];
            }
        });

        return torrents.length > 0 ? torrents : null;
    } catch (error) {
        console.error(`Error scraping YTS for ${title} (${year}):`, error.message);
        return null;
    }
}

// Scrape TorrentDownload.info for movie torrents
async function scrapeTorrentDownload(title, year, preferredQuality = '1080p') {
    try {
        // Search query format
        const searchQuery = encodeURIComponent(`${title} ${year}`);
        const url = `https://www.torrentdownload.info/search?q=${searchQuery}`;
        console.log(`Scraping TorrentDownload.info: ${url}`);

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        const torrents = [];

        // Parse search results table
        $('table.table2 tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length < 5) return; // Need all 5 columns

            const nameCell = $(cells[0]);
            const torrentName = nameCell.find('.tt-name a').first().text().trim();
            const torrentLink = nameCell.find('.tt-name a').first().attr('href');

            if (!torrentName || !torrentLink) return;

            // Extract size from third column (cells[2])
            const sizeText = $(cells[2]).text().trim();

            // Extract seeders from fourth column (cells[3])
            const seedersText = $(cells[3]).text().trim().replace(/,/g, '');
            const seeders = parseInt(seedersText) || 0;

            // Skip if no seeders or very low seeders
            if (seeders < 1) return;

            // Extract quality from torrent name
            const qualityMatch = torrentName.match(/(\d{3,4}p|2160p|1080p|720p|480p)/i);
            const quality = qualityMatch ? qualityMatch[1] : null;

            // Must be a video file (check for movie-related terms and size > 500MB)
            const isMovie = /\.(mkv|mp4|avi|mov)/i.test(torrentName) ||
                           /BluRay|BRRip|WEB|HDRip/i.test(torrentName);

            const sizeMatch = sizeText.match(/([\d.]+)\s*(GB|MB)/i);
            const sizeInMB = sizeMatch ?
                (sizeMatch[2].toUpperCase() === 'GB' ? parseFloat(sizeMatch[1]) * 1024 : parseFloat(sizeMatch[1]))
                : 0;

            if (!isMovie || sizeInMB < 500) return;

            torrents.push({
                name: torrentName,
                quality: quality,
                size: sizeText,
                seeders: seeders,
                link: torrentLink ? `https://www.torrentdownload.info${torrentLink}` : null
            });
        });

        if (torrents.length === 0) {
            return null;
        }

        // Sort by quality match and seeders
        const qualityPreference = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };
        torrents.sort((a, b) => {
            const aQualityMatch = a.quality === preferredQuality ? 1000 : 0;
            const bQualityMatch = b.quality === preferredQuality ? 1000 : 0;
            const aQualityScore = qualityPreference[a.quality] || 0;
            const bQualityScore = qualityPreference[b.quality] || 0;

            return (bQualityMatch + bQualityScore * 10 + b.seeders) -
                   (aQualityMatch + aQualityScore * 10 + a.seeders);
        });

        const bestTorrent = torrents[0];

        // Need to fetch the torrent page to get magnet link
        if (bestTorrent.link) {
            const torrentPage = await axios.get(bestTorrent.link, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const $page = cheerio.load(torrentPage.data);
            const magnetLink = $page('a[href^="magnet:?"]').attr('href');

            if (magnetLink) {
                return {
                    quality: bestTorrent.quality || 'Unknown',
                    size: bestTorrent.size,
                    magnetLink: magnetLink,
                    seeders: bestTorrent.seeders
                };
            }
        }

        return null;
    } catch (error) {
        console.error(`Error scraping TorrentDownload.info for ${title} (${year}):`, error.message);
        return null;
    }
}

// Scrape TorrentDownloads.pro for movie torrents
async function scrapeTorrentDownloadsPro(title, year, preferredQuality = '1080p') {
    try {
        const searchQuery = encodeURIComponent(`${title} ${year}`);
        const url = `https://www.torrentdownloads.pro/search/?search=${searchQuery}`;
        console.log(`Scraping TorrentDownloads.pro: ${url}`);

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        const torrents = [];

        // Parse grey_bar3 divs
        $('div.grey_bar3').each((i, div) => {
            const $div = $(div);

            // Get torrent name and link
            const link = $div.find('p a').first();
            const torrentName = link.text().trim();
            const torrentLink = link.attr('href');

            if (!torrentName || !torrentLink) return;

            // Get spans (after health image)
            const spans = $div.find('span').filter((i, el) => {
                return !$(el).hasClass('health') && !$(el).hasClass('check_box') && !$(el).hasClass('cloud');
            });

            const leechers = $(spans[0]).text().trim();
            const seeders = $(spans[1]).text().trim();
            const sizeText = $(spans[2]).text().trim();

            const seedersNum = parseInt(seeders) || 0;
            if (seedersNum < 1) return;

            // Extract quality from name
            const qualityMatch = torrentName.match(/(\d{3,4}p|2160p|1080p|720p|480p)/i);
            const quality = qualityMatch ? qualityMatch[1] : null;

            // Filter by movie indicators and size
            const isMovie = /BluRay|BRRip|WEB|HDRip|WEB-DL/i.test(torrentName);
            const sizeMatch = sizeText.match(/([\d.]+)\s*(GB|MB)/i);
            const sizeInMB = sizeMatch ?
                (sizeMatch[2].toUpperCase() === 'GB' ? parseFloat(sizeMatch[1]) * 1024 : parseFloat(sizeMatch[1]))
                : 0;

            if (!isMovie || sizeInMB < 500) return;

            torrents.push({
                name: torrentName,
                quality: quality,
                size: sizeText,
                seeders: seedersNum,
                link: `https://www.torrentdownloads.pro${torrentLink}`
            });
        });

        if (torrents.length === 0) {
            return null;
        }

        // Sort by quality match and seeders
        const qualityPreference = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };
        torrents.sort((a, b) => {
            const aQualityMatch = a.quality === preferredQuality ? 1000 : 0;
            const bQualityMatch = b.quality === preferredQuality ? 1000 : 0;
            const aQualityScore = qualityPreference[a.quality] || 0;
            const bQualityScore = qualityPreference[b.quality] || 0;

            return (bQualityMatch + bQualityScore * 10 + b.seeders) -
                   (aQualityMatch + aQualityScore * 10 + a.seeders);
        });

        const bestTorrent = torrents[0];

        // Fetch detail page for magnet link
        if (bestTorrent.link) {
            const torrentPage = await axios.get(bestTorrent.link, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const $page = cheerio.load(torrentPage.data);
            const magnetLink = $page('a[href^="magnet:?"]').attr('href');

            if (magnetLink) {
                return {
                    quality: bestTorrent.quality || 'Unknown',
                    size: bestTorrent.size,
                    magnetLink: magnetLink,
                    seeders: bestTorrent.seeders
                };
            }
        }

        return null;
    } catch (error) {
        console.error(`Error scraping TorrentDownloads.pro for ${title} (${year}):`, error.message);
        return null;
    }
}

// Convert size string to bytes for calculation
function sizeToBytes(sizeStr) {
    if (!sizeStr) return 0;

    const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    switch (unit) {
        case 'GB': return value * 1024 * 1024 * 1024;
        case 'MB': return value * 1024 * 1024;
        case 'KB': return value * 1024;
        default: return 0;
    }
}

// Format bytes to human readable size
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
}

// Torrent-Api-py local API integration (Tier 3 fallback)
async function searchTorrentApiPy(movieTitle, year, preferredQuality = '1080p') {
    const API_BASE = 'http://localhost:8009/api/v1';

    // Sites to try in order - ONLY user requested sites (working sites first)
    // Working: torrentproject, kickass, piratebay
    // Failing: glodls, bitsearch, torlock (kept as fallback)
    const sites = ['torrentproject', 'kickass', 'piratebay', 'glodls', 'bitsearch', 'torlock'];

    const searchQuery = `${movieTitle} ${year}`;

    for (const site of sites) {
        try {
            console.log(`Trying Torrent-Api-py: ${site} for "${searchQuery}"`);

            const response = await axios.get(`${API_BASE}/search`, {
                params: {
                    site: site,
                    query: searchQuery,
                    limit: 10
                },
                timeout: 15000
            });

            if (response.data && response.data.data && response.data.data.length > 0) {
                const results = response.data.data;

                // STEP 1: Filter out torrents with 0 seeds and ensure magnet exists
                const validResults = results.filter(r =>
                    r.magnet &&
                    parseInt(r.seeders || 0) > 0
                );

                if (validResults.length === 0) {
                    console.log(`${site}: No valid torrents found (all 0 seeds or no magnet)`);
                    continue; // Try next site
                }

                // STEP 2: Sort by seeds (highest first)
                validResults.sort((a, b) => {
                    const seedsA = parseInt(a.seeders) || 0;
                    const seedsB = parseInt(b.seeders) || 0;
                    return seedsB - seedsA;
                });

                // STEP 3: Try to find quality match from top 5 highest-seeded
                const topResults = validResults.slice(0, 5);
                let selectedTorrent = topResults.find(r =>
                    r.name && r.name.toLowerCase().includes(preferredQuality.toLowerCase())
                );

                // STEP 4: If no quality match, use highest seeded
                if (!selectedTorrent) {
                    selectedTorrent = validResults[0];
                }

                // STEP 5: Return result
                const qualityMatch = selectedTorrent.name.match(/(\d+p)/i);
                const seeds = parseInt(selectedTorrent.seeders || 0);

                console.log(`${site}: Found "${selectedTorrent.name}" (${seeds} seeds)`);

                return {
                    quality: qualityMatch ? qualityMatch[1] : 'Unknown',
                    size: selectedTorrent.size || 'Unknown',
                    seeds: seeds.toString(),
                    magnetLink: selectedTorrent.magnet,
                    source: site
                };
            }

            // Rate limit between site attempts
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`Error searching ${site} via Torrent-Api-py:`, error.message);
            // Continue to next site
            continue;
        }
    }

    return null; // No results from any site
}

// Load torrent conversion history
async function loadTorrentHistory() {
    const data = await fs.readFile(TORRENT_HISTORY_FILE, 'utf8');
    return JSON.parse(data);
}

// Save torrent conversion history
async function saveTorrentHistory(history) {
    await fs.writeFile(TORRENT_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Download client management functions

// Encrypt password
function encryptPassword(password) {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// Decrypt password
function decryptPassword(encryptedPassword) {
    const parts = encryptedPassword.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Load download clients
async function loadDownloadClients() {
    const data = await fs.readFile(DOWNLOAD_CLIENTS_FILE, 'utf8');
    return JSON.parse(data);
}

// Save download clients
async function saveDownloadClients(clients) {
    await fs.writeFile(DOWNLOAD_CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

// Format movie name for torrent client
function formatMovieName(title, year, quality) {
    // Clean title: remove special characters that break filesystems
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '');

    // Format: "Movie Title (2023) [1080p]"
    let name = `${cleanTitle} (${year})`;
    if (quality) {
        name += ` [${quality}]`;
    }
    return name;
}

// Torrent Client Abstraction Layer

class TorrentClient {
    constructor(config) {
        this.config = config;
        this.type = config.type;
        this.url = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}`;
    }

    async testConnection() {
        throw new Error('testConnection must be implemented by subclass');
    }

    async addTorrent(magnetLink, options = {}) {
        throw new Error('addTorrent must be implemented by subclass');
    }
}

// qBittorrent Client Implementation
class QBittorrentClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.cookie = null;
    }

    async login() {
        try {
            const response = await axios.post(`${this.url}/api/v2/auth/login`,
                `username=${encodeURIComponent(this.config.username)}&password=${encodeURIComponent(decryptPassword(this.config.password))}`,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 10000
                }
            );

            if (response.headers['set-cookie']) {
                this.cookie = response.headers['set-cookie'][0];
                return true;
            }
            return false;
        } catch (error) {
            console.error('qBittorrent login error:', error.message);
            return false;
        }
    }

    async testConnection() {
        try {
            const loggedIn = await this.login();
            if (!loggedIn) {
                return { success: false, error: 'Authentication failed' };
            }

            const response = await axios.get(`${this.url}/api/v2/app/version`, {
                headers: { Cookie: this.cookie },
                timeout: 10000
            });

            return {
                success: true,
                version: response.data,
                client: 'qBittorrent'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            if (!this.cookie) {
                await this.login();
            }

            const params = new URLSearchParams();
            params.append('urls', magnetLink);

            if (options.name) {
                params.append('rename', options.name);
            }
            if (options.category) {
                params.append('category', options.category);
            }

            const response = await axios.post(
                `${this.url}/api/v2/torrents/add`,
                params.toString(),
                {
                    headers: {
                        Cookie: this.cookie,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );

            return { success: response.data === 'Ok.', magnetLink };
        } catch (error) {
            console.error('qBittorrent addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            if (!this.cookie) {
                await this.login();
            }

            const response = await axios.get(
                `${this.url}/api/v2/torrents/info`,
                {
                    headers: { Cookie: this.cookie },
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Find torrent by hash
            const torrents = response.data;
            return torrents.find(t => t.hash.toLowerCase() === targetHash);
        } catch (error) {
            console.error('qBittorrent getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(hash) {
        try {
            if (!this.cookie) {
                await this.login();
            }

            const response = await axios.get(
                `${this.url}/api/v2/torrents/files?hash=${hash}`,
                {
                    headers: { Cookie: this.cookie },
                    timeout: 10000
                }
            );

            return response.data;
        } catch (error) {
            console.error('qBittorrent getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(hash, oldPath, newPath) {
        try {
            if (!this.cookie) {
                await this.login();
            }

            const params = new URLSearchParams();
            params.append('hash', hash);
            params.append('oldPath', oldPath);
            params.append('newPath', newPath);

            const response = await axios.post(
                `${this.url}/api/v2/torrents/renameFile`,
                params.toString(),
                {
                    headers: {
                        Cookie: this.cookie,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );

            return { success: response.status === 200 };
        } catch (error) {
            console.error('qBittorrent renameFile error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async renameFolder(hash, oldPath, newPath) {
        try {
            if (!this.cookie) {
                await this.login();
            }

            const params = new URLSearchParams();
            params.append('hash', hash);
            params.append('oldPath', oldPath);
            params.append('newPath', newPath);

            const response = await axios.post(
                `${this.url}/api/v2/torrents/renameFolder`,
                params.toString(),
                {
                    headers: {
                        Cookie: this.cookie,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );

            return { success: response.status === 200 };
        } catch (error) {
            console.error('qBittorrent renameFolder error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Transmission Client Implementation
class TransmissionClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.sessionId = null;
        this.url = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}/transmission/rpc`;
    }

    async getRpcSession() {
        try {
            await axios.post(this.url, {}, {
                auth: {
                    username: this.config.username,
                    password: decryptPassword(this.config.password)
                },
                timeout: 10000
            });
        } catch (error) {
            if (error.response && error.response.status === 409) {
                this.sessionId = error.response.headers['x-transmission-session-id'];
                return true;
            }
        }
        return false;
    }

    async testConnection() {
        try {
            await this.getRpcSession();
            if (!this.sessionId) {
                return { success: false, error: 'Could not get session ID' };
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'session-get'
                },
                {
                    auth: {
                        username: this.config.username,
                        password: decryptPassword(this.config.password)
                    },
                    headers: {
                        'X-Transmission-Session-Id': this.sessionId
                    },
                    timeout: 10000
                }
            );

            if (response.data.result === 'success') {
                return {
                    success: true,
                    version: response.data.arguments.version,
                    client: 'Transmission'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            if (!this.sessionId) {
                await this.getRpcSession();
            }

            const args = {
                filename: magnetLink
            };

            if (options.downloadDir) {
                args['download-dir'] = options.downloadDir;
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'torrent-add',
                    arguments: args
                },
                {
                    auth: {
                        username: this.config.username,
                        password: decryptPassword(this.config.password)
                    },
                    headers: {
                        'X-Transmission-Session-Id': this.sessionId
                    },
                    timeout: 10000
                }
            );

            if (response.data.result === 'success') {
                return { success: true, magnetLink };
            }

            return { success: false, error: response.data.result };
        } catch (error) {
            console.error('Transmission addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            if (!this.sessionId) {
                await this.getRpcSession();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'torrent-get',
                    arguments: {
                        fields: ['id', 'name', 'hashString', 'metadataPercentComplete', 'files', 'fileStats', 'downloadDir']
                    }
                },
                {
                    auth: {
                        username: this.config.username,
                        password: decryptPassword(this.config.password)
                    },
                    headers: {
                        'X-Transmission-Session-Id': this.sessionId
                    },
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            const torrents = response.data.arguments.torrents;
            return torrents.find(t => t.hashString.toLowerCase() === targetHash);
        } catch (error) {
            console.error('Transmission getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentId) {
        try {
            if (!this.sessionId) {
                await this.getRpcSession();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'torrent-get',
                    arguments: {
                        ids: [torrentId],
                        fields: ['files', 'fileStats']
                    }
                },
                {
                    auth: {
                        username: this.config.username,
                        password: decryptPassword(this.config.password)
                    },
                    headers: {
                        'X-Transmission-Session-Id': this.sessionId
                    },
                    timeout: 10000
                }
            );

            if (response.data.arguments.torrents.length > 0) {
                return response.data.arguments.torrents[0].files;
            }
            return null;
        } catch (error) {
            console.error('Transmission getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentId, oldPath, newPath) {
        try {
            if (!this.sessionId) {
                await this.getRpcSession();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'torrent-rename-path',
                    arguments: {
                        ids: [torrentId],
                        path: oldPath,
                        name: newPath
                    }
                },
                {
                    auth: {
                        username: this.config.username,
                        password: decryptPassword(this.config.password)
                    },
                    headers: {
                        'X-Transmission-Session-Id': this.sessionId
                    },
                    timeout: 10000
                }
            );

            return { success: response.data.result === 'success' };
        } catch (error) {
            console.error('Transmission renameFile error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async renameFolder(torrentId, oldPath, newPath) {
        // In Transmission, renaming a folder is the same as renaming a path
        return this.renameFile(torrentId, oldPath, newPath);
    }
}

// Deluge Client Implementation
class DelugeClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.sessionCookie = null;
        this.url = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}/json`;
        this.requestId = 1;
    }

    async login() {
        try {
            const response = await axios.post(
                this.url,
                {
                    method: 'auth.login',
                    params: [decryptPassword(this.config.password)],
                    id: this.requestId++
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            if (response.data.result === true && response.headers['set-cookie']) {
                this.sessionCookie = response.headers['set-cookie'][0];
                return true;
            }
            return false;
        } catch (error) {
            console.error('Deluge login error:', error.message);
            return false;
        }
    }

    async testConnection() {
        try {
            const loggedIn = await this.login();
            if (!loggedIn) {
                return { success: false, error: 'Authentication failed' };
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'daemon.info',
                    params: [],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            if (response.data.result) {
                return {
                    success: true,
                    version: response.data.result,
                    client: 'Deluge'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            if (!this.sessionCookie) {
                await this.login();
            }

            const addOptions = {};

            if (options.name) {
                addOptions.name = options.name;
            }
            if (options.category) {
                addOptions.label = options.category;
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'core.add_torrent_magnet',
                    params: [magnetLink, addOptions],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return { success: response.data.result !== null, magnetLink };
        } catch (error) {
            console.error('Deluge addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            if (!this.sessionCookie) {
                await this.login();
            }

            // Get all torrents
            const response = await axios.post(
                this.url,
                {
                    method: 'core.get_torrents_status',
                    params: [{}, ['name', 'state', 'progress', 'files', 'save_path']],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Find torrent by hash
            const torrents = response.data.result;
            for (const [hash, info] of Object.entries(torrents)) {
                if (hash.toLowerCase() === targetHash) {
                    return { id: hash, ...info };
                }
            }
            return null;
        } catch (error) {
            console.error('Deluge getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentId) {
        try {
            if (!this.sessionCookie) {
                await this.login();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'core.get_torrent_status',
                    params: [torrentId, ['files']],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return response.data.result.files;
        } catch (error) {
            console.error('Deluge getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentId, fileIndex, newName) {
        try {
            if (!this.sessionCookie) {
                await this.login();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'core.rename_files',
                    params: [torrentId, [[fileIndex, newName]]],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return { success: response.data.result !== null };
        } catch (error) {
            console.error('Deluge renameFile error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async renameFolder(torrentId, oldPath, newPath) {
        try {
            if (!this.sessionCookie) {
                await this.login();
            }

            const response = await axios.post(
                this.url,
                {
                    method: 'core.rename_folder',
                    params: [torrentId, oldPath, newPath],
                    id: this.requestId++
                },
                {
                    headers: {
                        Cookie: this.sessionCookie,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return { success: response.data.result !== null };
        } catch (error) {
            console.error('Deluge renameFolder error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Aria2 Client Implementation
class Aria2Client extends TorrentClient {
    constructor(config) {
        super(config);
        this.url = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}/jsonrpc`;
        this.token = config.password ? `token:${decryptPassword(config.password)}` : '';
        this.requestId = 1;
    }

    async testConnection() {
        try {
            const response = await axios.post(
                this.url,
                {
                    jsonrpc: '2.0',
                    method: 'aria2.getVersion',
                    id: this.requestId++,
                    params: this.token ? [this.token] : []
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            if (response.data.result) {
                return {
                    success: true,
                    version: response.data.result.version,
                    client: 'Aria2'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            const params = this.token ? [this.token, [magnetLink]] : [[magnetLink]];

            // Add options if provided
            const aria2Options = {};
            if (options.name) {
                aria2Options['bt-metadata-only'] = 'false';
                aria2Options['bt-save-metadata'] = 'true';
            }

            if (Object.keys(aria2Options).length > 0) {
                params.push(aria2Options);
            }

            const response = await axios.post(
                this.url,
                {
                    jsonrpc: '2.0',
                    method: 'aria2.addUri',
                    id: this.requestId++,
                    params: params
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            // Aria2 returns a GID (download ID) on success
            return { success: response.data.result !== null, magnetLink, gid: response.data.result };
        } catch (error) {
            console.error('Aria2 addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            // Get all active downloads
            const params = this.token ? [this.token, ['gid', 'status', 'totalLength', 'completedLength', 'infoHash', 'files']] : [['gid', 'status', 'totalLength', 'completedLength', 'infoHash', 'files']];

            const response = await axios.post(
                this.url,
                {
                    jsonrpc: '2.0',
                    method: 'aria2.tellActive',
                    id: this.requestId++,
                    params: params
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Find torrent by hash
            const torrents = response.data.result || [];
            for (const torrent of torrents) {
                if (torrent.infoHash && torrent.infoHash.toLowerCase() === targetHash) {
                    // Check if metadata is complete
                    const hasMetadata = torrent.files && torrent.files.length > 0;
                    return {
                        id: torrent.gid,
                        state: torrent.status,
                        metadataPercentComplete: hasMetadata ? 1 : 0,
                        ...torrent
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('Aria2 getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentGid) {
        try {
            const params = this.token ? [this.token, torrentGid] : [torrentGid];

            const response = await axios.post(
                this.url,
                {
                    jsonrpc: '2.0',
                    method: 'aria2.getFiles',
                    id: this.requestId++,
                    params: params
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            // Convert Aria2 file format to our standard format
            const files = response.data.result || [];
            return files.map(f => ({
                name: f.path.split('/').pop(),
                path: f.path,
                size: parseInt(f.length),
                index: parseInt(f.index)
            }));
        } catch (error) {
            console.error('Aria2 getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentGid, fileIndex, newName) {
        // Aria2 doesn't support file renaming directly
        // Would need to use OS file operations after download
        console.log('Aria2 does not support file renaming via API');
        return { success: false, error: 'Aria2 does not support file renaming' };
    }

    async renameFolder(torrentGid, oldPath, newPath) {
        // Aria2 doesn't support folder renaming
        console.log('Aria2 does not support folder renaming via API');
        return { success: false, error: 'Aria2 does not support folder renaming' };
    }

    async deleteTorrent(torrentGid, deleteFiles = false) {
        try {
            const params = this.token ? [this.token, torrentGid] : [torrentGid];

            // First try to remove active download
            const response = await axios.post(
                this.url,
                {
                    jsonrpc: '2.0',
                    method: 'aria2.remove',
                    id: this.requestId++,
                    params: params
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );

            // Note: Aria2 doesn't delete files automatically, would need manual deletion
            return { success: response.data.result !== null };
        } catch (error) {
            console.error('Aria2 deleteTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Tribler Client Implementation
class TriblerClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.baseUrl = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}`;
        this.apiKey = config.password ? decryptPassword(config.password) : '';
    }

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['X-Api-Key'] = this.apiKey;
        }
        return headers;
    }

    async testConnection() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/state`,
                {
                    headers: this.getHeaders(),
                    timeout: 10000
                }
            );

            if (response.data) {
                return {
                    success: true,
                    version: response.data.version || 'Unknown',
                    client: 'Tribler'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            const response = await axios.put(
                `${this.baseUrl}/api/downloads`,
                {
                    uri: magnetLink,
                    anon_hops: 0
                },
                {
                    headers: this.getHeaders(),
                    timeout: 10000
                }
            );

            return { success: response.data && response.data.started !== false, magnetLink };
        } catch (error) {
            console.error('Tribler addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/downloads?get_peers=0&get_pieces=0`,
                {
                    headers: this.getHeaders(),
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Find torrent by hash
            const downloads = response.data.downloads || [];
            for (const download of downloads) {
                if (download.infohash && download.infohash.toLowerCase() === targetHash) {
                    return {
                        id: download.infohash,
                        state: download.status,
                        progress: download.progress,
                        name: download.name,
                        files: download.files
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('Tribler getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentHash) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/downloads/${torrentHash}/files`,
                {
                    headers: this.getHeaders(),
                    timeout: 10000
                }
            );

            const files = response.data.files || [];
            return files.map((f, index) => ({
                name: f.name,
                path: f.name,
                size: f.size,
                index: index
            }));
        } catch (error) {
            console.error('Tribler getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentHash, fileIndex, newName) {
        // Tribler doesn't support file renaming via API
        console.log('Tribler does not support file renaming via API');
        return { success: false, error: 'Tribler does not support file renaming' };
    }

    async renameFolder(torrentHash, oldPath, newPath) {
        // Tribler doesn't support folder renaming
        console.log('Tribler does not support folder renaming via API');
        return { success: false, error: 'Tribler does not support folder renaming' };
    }

    async deleteTorrent(torrentHash, deleteFiles = false) {
        try {
            const response = await axios.delete(
                `${this.baseUrl}/api/downloads/${torrentHash}`,
                {
                    headers: this.getHeaders(),
                    data: { remove_data: deleteFiles },
                    timeout: 10000
                }
            );

            return { success: response.status === 200 };
        } catch (error) {
            console.error('Tribler deleteTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// uTorrent Client Implementation
class UTorrentClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.baseUrl = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}/gui`;
        this.auth = {
            username: config.username || 'admin',
            password: decryptPassword(config.password)
        };
        this.token = null;
    }

    async getToken() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/token.html`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            // Extract token from response
            const match = response.data.match(/<div[^>]*>([^<]+)<\/div>/);
            if (match) {
                this.token = match[1];
                return this.token;
            }
            throw new Error('Token not found');
        } catch (error) {
            console.error('uTorrent getToken error:', error.message);
            throw error;
        }
    }

    async testConnection() {
        try {
            await this.getToken();

            const response = await axios.get(
                `${this.baseUrl}/?token=${this.token}&list=1`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            if (response.data) {
                return {
                    success: true,
                    version: response.data.build || 'Unknown',
                    client: 'uTorrent'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            if (!this.token) {
                await this.getToken();
            }

            const params = new URLSearchParams({
                token: this.token,
                action: 'add-url',
                s: magnetLink
            });

            const response = await axios.post(
                `${this.baseUrl}/?${params.toString()}`,
                null,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            return { success: response.status === 200, magnetLink };
        } catch (error) {
            console.error('uTorrent addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            if (!this.token) {
                await this.getToken();
            }

            const response = await axios.get(
                `${this.baseUrl}/?token=${this.token}&list=1`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            // Extract hash from magnet link
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Parse torrent list
            const torrents = response.data.torrents || [];
            for (const torrent of torrents) {
                // torrent format: [hash, status, name, size, progress, ...]
                const hash = torrent[0];
                if (hash && hash.toLowerCase() === targetHash) {
                    return {
                        id: hash,
                        hash: hash,
                        state: torrent[1],
                        name: torrent[2],
                        progress: torrent[4] / 1000 // uTorrent uses permille
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('uTorrent getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentHash) {
        try {
            if (!this.token) {
                await this.getToken();
            }

            const response = await axios.get(
                `${this.baseUrl}/?token=${this.token}&action=getfiles&hash=${torrentHash}`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            const files = response.data.files?.[1] || [];
            return files.map((f, index) => ({
                name: f[0],
                path: f[0],
                size: f[1],
                index: index
            }));
        } catch (error) {
            console.error('uTorrent getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentHash, fileIndex, newName) {
        // uTorrent WebUI doesn't support file renaming directly
        console.log('uTorrent WebUI does not support file renaming');
        return { success: false, error: 'uTorrent WebUI does not support file renaming' };
    }

    async renameFolder(torrentHash, oldPath, newPath) {
        console.log('uTorrent WebUI does not support folder renaming');
        return { success: false, error: 'uTorrent WebUI does not support folder renaming' };
    }

    async deleteTorrent(torrentHash, deleteFiles = false) {
        try {
            if (!this.token) {
                await this.getToken();
            }

            const action = deleteFiles ? 'removedata' : 'remove';
            const response = await axios.get(
                `${this.baseUrl}/?token=${this.token}&action=${action}&hash=${torrentHash}`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            return { success: response.status === 200 };
        } catch (error) {
            console.error('uTorrent deleteTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// rTorrent Client Implementation (XML-RPC)
class RTorrentClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.baseUrl = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}/RPC2`;
        this.auth = {
            username: config.username || '',
            password: config.password ? decryptPassword(config.password) : ''
        };
        this.xmlBuilder = new xml2js.Builder({ headless: true });
        this.xmlParser = new xml2js.Parser({ explicitArray: false });
    }

    buildXMLRPC(method, params = []) {
        const methodCall = {
            methodCall: {
                methodName: method,
                params: {
                    param: params.map(p => ({ value: typeof p === 'string' ? { string: p } : { int: p } }))
                }
            }
        };
        return this.xmlBuilder.buildObject(methodCall);
    }

    async callXMLRPC(method, params = []) {
        try {
            const xml = this.buildXMLRPC(method, params);
            const response = await axios.post(
                this.baseUrl,
                xml,
                {
                    auth: this.auth.username ? this.auth : undefined,
                    headers: { 'Content-Type': 'text/xml' },
                    timeout: 10000
                }
            );

            const result = await this.xmlParser.parseStringPromise(response.data);
            return result;
        } catch (error) {
            console.error(`rTorrent ${method} error:`, error.message);
            throw error;
        }
    }

    async testConnection() {
        try {
            const result = await this.callXMLRPC('system.client_version');

            if (result && result.methodResponse) {
                return {
                    success: true,
                    version: result.methodResponse.params?.param?.value?.string || 'Unknown',
                    client: 'rTorrent'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            // Use load.start to add and start torrent
            await this.callXMLRPC('load.start', ['', magnetLink]);
            return { success: true, magnetLink };
        } catch (error) {
            console.error('rTorrent addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            // Get list of all torrents with their hashes
            const result = await this.callXMLRPC('download_list');

            if (!result.methodResponse) return null;

            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toUpperCase();

            const hashes = result.methodResponse.params?.param?.value?.array?.data?.value || [];
            const hashArray = Array.isArray(hashes) ? hashes : [hashes];

            for (const hashObj of hashArray) {
                const hash = hashObj.string;
                if (hash && hash.toUpperCase() === targetHash) {
                    // Get torrent details
                    const nameResult = await this.callXMLRPC('d.name', [hash]);
                    const stateResult = await this.callXMLRPC('d.state', [hash]);

                    return {
                        id: hash,
                        hash: hash,
                        name: nameResult.methodResponse.params?.param?.value?.string || '',
                        state: stateResult.methodResponse.params?.param?.value?.int || 0
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('rTorrent getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentHash) {
        try {
            const result = await this.callXMLRPC('f.multicall', [torrentHash, '', 'f.path=', 'f.size_bytes=']);

            if (!result.methodResponse) return null;

            const files = result.methodResponse.params?.param?.value?.array?.data?.value || [];
            const filesArray = Array.isArray(files) ? files : [files];

            return filesArray.map((f, index) => {
                const fileData = f.array?.data?.value || [];
                return {
                    name: fileData[0]?.string || '',
                    path: fileData[0]?.string || '',
                    size: parseInt(fileData[1]?.string || 0),
                    index: index
                };
            });
        } catch (error) {
            console.error('rTorrent getTorrentFiles error:', error.message);
            return null;
        }
    }

    async renameFile(torrentHash, fileIndex, newName) {
        try {
            await this.callXMLRPC('f.set_path', [torrentHash, fileIndex, newName]);
            return { success: true };
        } catch (error) {
            console.error('rTorrent renameFile error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async renameFolder(torrentHash, oldPath, newPath) {
        // rTorrent doesn't have direct folder renaming
        console.log('rTorrent does not support folder renaming directly');
        return { success: false, error: 'rTorrent does not support folder renaming' };
    }

    async deleteTorrent(torrentHash, deleteFiles = false) {
        try {
            if (deleteFiles) {
                await this.callXMLRPC('d.erase', [torrentHash]);
            } else {
                await this.callXMLRPC('d.close', [torrentHash]);
                await this.callXMLRPC('d.erase', [torrentHash]);
            }
            return { success: true };
        } catch (error) {
            console.error('rTorrent deleteTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Tixati Client Implementation
class TixatiClient extends TorrentClient {
    constructor(config) {
        super(config);
        this.baseUrl = `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port}`;
        this.auth = {
            username: config.username || 'admin',
            password: decryptPassword(config.password)
        };
    }

    async testConnection() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/transfers`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            if (response.status === 200) {
                return {
                    success: true,
                    version: 'Unknown',
                    client: 'Tixati'
                };
            }

            return { success: false, error: 'Invalid response' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addTorrent(magnetLink, options = {}) {
        try {
            // Encode magnet link for URL
            const encodedMagnet = encodeURIComponent(magnetLink);
            const url = `${this.baseUrl}/transfers/action/add/url/${encodedMagnet}`;

            const response = await axios.get(
                url,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            return { success: response.status === 200, magnetLink };
        } catch (error) {
            console.error('Tixati addTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async getTorrentByMagnet(magnetLink) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/transfers`,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            // Parse HTML to find torrents
            const $ = cheerio.load(response.data);
            const hashMatch = magnetLink.match(/urn:btih:([a-fA-F0-9]+)/i);
            if (!hashMatch) return null;
            const targetHash = hashMatch[1].toLowerCase();

            // Look for torrent with matching hash in the page
            // Tixati displays torrents in a table - structure varies
            // This is a simplified implementation
            let foundTorrent = null;
            $('tr').each((i, row) => {
                const text = $(row).text();
                if (text.toLowerCase().includes(targetHash)) {
                    foundTorrent = {
                        id: targetHash,
                        hash: targetHash,
                        name: 'Torrent',
                        state: 'active'
                    };
                }
            });

            return foundTorrent;
        } catch (error) {
            console.error('Tixati getTorrentByMagnet error:', error.message);
            return null;
        }
    }

    async getTorrentFiles(torrentHash) {
        // Tixati's web interface doesn't provide easy programmatic access to file lists
        console.log('Tixati file listing via web interface is limited');
        return [];
    }

    async renameFile(torrentHash, fileIndex, newName) {
        console.log('Tixati does not support file renaming via web interface');
        return { success: false, error: 'Tixati does not support file renaming' };
    }

    async renameFolder(torrentHash, oldPath, newPath) {
        console.log('Tixati does not support folder renaming via web interface');
        return { success: false, error: 'Tixati does not support folder renaming' };
    }

    async deleteTorrent(torrentHash, deleteFiles = false) {
        try {
            // Tixati uses hash-based deletion
            const action = deleteFiles ? 'remove-delete' : 'remove';
            const url = `${this.baseUrl}/transfers/action/${action}/hash/${torrentHash}`;

            const response = await axios.get(
                url,
                {
                    auth: this.auth,
                    timeout: 10000
                }
            );

            return { success: response.status === 200 };
        } catch (error) {
            console.error('Tixati deleteTorrent error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Factory function to create appropriate client
function createTorrentClient(config) {
    const clientConfig = CLIENT_CONFIGS[config.type];

    if (!clientConfig) {
        throw new Error(`Unknown client type: ${config.type}`);
    }

    if (!clientConfig.implemented) {
        throw new Error(`Client type '${clientConfig.name}' is not yet implemented. Currently supported: qBittorrent, Transmission, Deluge, BiglyBT, Vuze, Aria2, Tribler, uTorrent, rTorrent, Tixati`);
    }

    switch (config.type) {
        case 'qbittorrent':
            return new QBittorrentClient(config);
        case 'transmission':
        case 'biglybt':
        case 'vuze':
            return new TransmissionClient(config);
        case 'deluge':
            return new DelugeClient(config);
        case 'aria2':
            return new Aria2Client(config);
        case 'tribler':
            return new TriblerClient(config);
        case 'utorrent':
            return new UTorrentClient(config);
        case 'rtorrent':
            return new RTorrentClient(config);
        case 'tixati':
            return new TixatiClient(config);
        default:
            throw new Error(`Unsupported client type: ${config.type}`);
    }
}

// Background worker to rename torrents after metadata is downloaded
async function waitAndRenameTorrent(client, magnetLink, desiredName) {
    const waitInterval = 5000; // 5 seconds

    // Aria2, Tribler, uTorrent, and Tixati don't support file renaming - skip this process
    if (client instanceof Aria2Client || client instanceof TriblerClient || client instanceof UTorrentClient || client instanceof TixatiClient) {
        console.log(`[RENAME] Skipping rename for ${client.config.type} (not supported): ${desiredName}`);
        return;
    }

    console.log(`[RENAME] Starting rename worker for: ${desiredName}`);

    let attempt = 0;
    while (true) { // Wait indefinitely until metadata is ready
        attempt++;
        try {
            // Wait before checking
            await new Promise(resolve => setTimeout(resolve, waitInterval));

            // Get torrent info
            const torrent = await client.getTorrentByMagnet(magnetLink);

            if (!torrent) {
                console.log(`[RENAME] Torrent not found yet, attempt ${attempt}`);
                continue;
            }

            // Check if metadata is downloaded (different for each client)
            let hasMetadata = false;
            let torrentId = null;
            let rootFolder = null;

            if (client instanceof QBittorrentClient) {
                // qBittorrent: check if metadata is complete (state != 'metaDL')
                hasMetadata = torrent.state && torrent.state !== 'metaDL';
                torrentId = torrent.hash;
            } else if (client instanceof TransmissionClient) {
                // Transmission: metadataPercentComplete should be 1
                hasMetadata = torrent.metadataPercentComplete === 1;
                torrentId = torrent.id;
            } else if (client instanceof DelugeClient) {
                // Deluge: state should not be 'Downloading Metadata'
                hasMetadata = torrent.state !== 'Downloading Metadata';
                torrentId = torrent.id;
            } else if (client instanceof Aria2Client) {
                // Aria2: check if files are available
                hasMetadata = torrent.metadataPercentComplete === 1;
                torrentId = torrent.id;
            } else if (client instanceof RTorrentClient) {
                // rTorrent: state 1 means started/active
                hasMetadata = torrent.state >= 1;
                torrentId = torrent.hash;
            }

            if (!hasMetadata) {
                console.log(`[RENAME] Metadata not ready yet for ${desiredName}, attempt ${attempt}`);
                continue;
            }

            console.log(`[RENAME] Metadata ready for ${desiredName}, fetching files...`);

            // Get file list
            const files = await client.getTorrentFiles(torrentId);

            if (!files || files.length === 0) {
                console.log(`[RENAME] No files found yet, attempt ${attempt}`);
                continue;
            }

            console.log(`[RENAME] Found ${files.length} file(s) for ${desiredName}`);

            // Find the largest video file
            const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
            let largestVideoFile = null;
            let largestSize = 0;

            for (const file of files) {
                const fileName = file.name || file.path || '';
                const fileSize = file.size || file.length || 0;

                const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
                if (videoExtensions.includes(ext) && fileSize > largestSize) {
                    largestVideoFile = file;
                    largestSize = fileSize;
                }
            }

            if (!largestVideoFile) {
                console.log(`[RENAME] No video file found for ${desiredName}`);
                return;
            }

            const oldPath = largestVideoFile.name || largestVideoFile.path;
            console.log(`[RENAME] Largest video file: ${oldPath}`);

            // Extract folder and file name
            const pathParts = oldPath.split('/');
            const oldFileName = pathParts[pathParts.length - 1];
            const ext = oldFileName.substring(oldFileName.lastIndexOf('.'));
            const newFileName = desiredName + ext;

            // Rename root folder if there is one
            if (pathParts.length > 1) {
                rootFolder = pathParts[0];
                const newRootFolder = desiredName;

                console.log(`[RENAME] Renaming folder: ${rootFolder} -> ${newRootFolder}`);

                try {
                    await client.renameFolder(torrentId, rootFolder, newRootFolder);
                    console.log(`[RENAME] ✓ Folder renamed successfully`);

                    // Update path for file rename
                    pathParts[0] = newRootFolder;
                } catch (error) {
                    console.error(`[RENAME] Failed to rename folder: ${error.message}`);
                }
            }

            // Rename the video file
            const newPath = pathParts.length > 1
                ? pathParts.slice(0, -1).join('/') + '/' + newFileName
                : newFileName;

            console.log(`[RENAME] Renaming file: ${oldPath} -> ${newPath}`);

            try {
                if (client instanceof DelugeClient) {
                    // Deluge uses file index instead of path
                    const fileIndex = files.indexOf(largestVideoFile);
                    await client.renameFile(torrentId, fileIndex, newPath);
                } else {
                    await client.renameFile(torrentId, oldPath, newPath);
                }

                console.log(`[RENAME] ✓ File renamed successfully: ${desiredName}`);
                return;
            } catch (error) {
                console.error(`[RENAME] Failed to rename file: ${error.message}`);
                return;
            }

        } catch (error) {
            console.error(`[RENAME] Error in rename worker: ${error.message}`);
        }
    }
}

// Endpoint to find movies
app.post('/api/find-movies', async (req, res) => {
    const { targetCount, language, includeInTheaters, useIMDB = false } = req.body;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const globalIds = await loadGlobalIds();

    // Load all existing movie IDs from all lists to check for cross-ID duplicates
    const existingTmdbIds = new Set();
    const existingImdbIds = new Set();

    try {
        const files = await fs.readdir(LISTS_DIR);
        for (const file of files) {
            const filepath = path.join(LISTS_DIR, file);
            const content = await fs.readFile(filepath, 'utf8');
            const ids = content.split('\n').filter(id => id.trim());

            for (const id of ids) {
                if (id.startsWith('tt')) {
                    existingImdbIds.add(id);
                } else if (/^\d+$/.test(id)) {
                    existingTmdbIds.add(id);
                }
            }
        }
        console.log(`[FIND-MOVIES] Loaded existing IDs - TMDB: ${existingTmdbIds.size}, IMDB: ${existingImdbIds.size}`);
    } catch (error) {
        console.error('[FIND-MOVIES] Error loading existing IDs:', error.message);
    }

    const newMovieIds = [];
    let page = 1;
    let consecutiveEmptyPages = 0;
    const maxConsecutiveEmptyPages = 5;
    let totalFetched = 0;
    let totalSkipped = 0;

    console.log(`[FIND-MOVIES] Starting search - Target: ${targetCount}, Language: ${language}, Include Theaters: ${includeInTheaters}, Use IMDB: ${useIMDB}`);

    try {
        while (newMovieIds.length < targetCount && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
            const movieIds = await fetchPopularMovies(language, page);

            console.log(`[FIND-MOVIES] Page ${page}: Fetched ${movieIds.length} movies from TMDB`);

            if (movieIds.length === 0) {
                consecutiveEmptyPages++;
                console.log(`[FIND-MOVIES] Page ${page}: Empty page (${consecutiveEmptyPages}/${maxConsecutiveEmptyPages})`);
                page++;
                continue;
            }

            consecutiveEmptyPages = 0;
            totalFetched += movieIds.length;

            // Filter out duplicates
            const newIds = movieIds.filter(id => !globalIds.has(id) && !newMovieIds.includes(id));
            console.log(`[FIND-MOVIES] Page ${page}: ${newIds.length} new movies after dedup (${movieIds.length - newIds.length} already seen)`);

            let pageSkipped = 0;
            let pageAdded = 0;

            for (const id of newIds) {
                if (newMovieIds.length >= targetCount) break;

                // Check if TMDB ID already exists in existing lists
                if (existingTmdbIds.has(id.toString())) {
                    console.log(`[FIND-MOVIES] Skipping TMDB ${id} - already exists in a TMDB list`);
                    pageSkipped++;
                    totalSkipped++;
                    continue;
                }

                // If not including in-theater movies, check if movie has non-theatrical releases
                if (!includeInTheaters) {
                    const hasRelease = await hasNonTheatricalRelease(id);
                    if (!hasRelease) {
                        pageSkipped++;
                        totalSkipped++;
                        continue; // Skip theatrical-only movies
                    }
                }

                // If using IMDB mode, convert TMDB ID to IMDB ID
                let movieId = id;
                if (useIMDB) {
                    const imdbId = await getImdbId(id);
                    if (!imdbId) {
                        console.log(`[FIND-MOVIES] Skipping TMDB ${id} - no IMDB ID found`);
                        pageSkipped++;
                        totalSkipped++;
                        continue; // Skip movies without IMDB IDs
                    }

                    // Check if IMDB ID already exists in existing lists
                    if (existingImdbIds.has(imdbId)) {
                        console.log(`[FIND-MOVIES] Skipping TMDB ${id} (IMDB ${imdbId}) - already exists in an IMDB list`);
                        pageSkipped++;
                        totalSkipped++;
                        continue;
                    }

                    movieId = imdbId;
                } else {
                    // In TMDB mode, check if this movie exists in any IMDB list
                    const imdbId = await getImdbId(id);
                    if (imdbId && existingImdbIds.has(imdbId)) {
                        console.log(`[FIND-MOVIES] Skipping TMDB ${id} - equivalent IMDB ${imdbId} already exists in an IMDB list`);
                        pageSkipped++;
                        totalSkipped++;
                        continue;
                    }
                }

                newMovieIds.push(movieId);
                globalIds.add(id); // Still track TMDB ID in global list to avoid duplicates
                pageAdded++;

                // Send progress update after each movie is added
                res.write(`data: ${JSON.stringify({ count: newMovieIds.length, target: targetCount })}\n\n`);
            }

            console.log(`[FIND-MOVIES] Page ${page}: Added ${pageAdded}, Skipped ${pageSkipped}. Total: ${newMovieIds.length}/${targetCount} (Total fetched: ${totalFetched}, Total skipped: ${totalSkipped})`);

            page++;

            // Check TMDB API page limit (TMDB has a 500-page limit)
            if (page > 500) {
                console.log(`[FIND-MOVIES] WARNING: Reached TMDB page limit (500). Stopping search.`);
                console.log(`[FIND-MOVIES] Final count: ${newMovieIds.length}/${targetCount}`);
                break;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // If we hit the consecutive empty pages limit but haven't reached target, warn user
        if (consecutiveEmptyPages >= maxConsecutiveEmptyPages && newMovieIds.length < targetCount) {
            console.log(`[FIND-MOVIES] WARNING: Hit ${maxConsecutiveEmptyPages} consecutive empty pages. TMDB may have exhausted results for language '${language}'.`);
            console.log(`[FIND-MOVIES] Consider: 1) Using a different language filter, 2) Removing language filter, or 3) Lowering target count`);
            console.log(`[FIND-MOVIES] Movies with original language '${language}' available in TMDB: approximately ${totalFetched} total`);
        }

        console.log(`[FIND-MOVIES] Search completed. Final results: ${newMovieIds.length}/${targetCount} movies found (Pages: ${page-1}, Total fetched: ${totalFetched}, Total skipped: ${totalSkipped})`);

        // Save the new global IDs
        await saveGlobalIds(globalIds);

        // Create timestamp and filename
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const filename = `movies_${Date.now()}.txt`;
        const filepath = path.join(LISTS_DIR, filename);

        // Save the list
        await fs.writeFile(filepath, newMovieIds.join('\n'));

        // Update history
        const history = await loadHistory();
        history.push({
            filename: filename,
            date: timestamp,
            count: newMovieIds.length,
            language: language
        });
        await saveHistory(history);

        // Send completion message
        res.write(`data: ${JSON.stringify({
            complete: true,
            count: newMovieIds.length,
            filename: filename,
            timestamp: timestamp
        })}\n\n`);

        res.end();
    } catch (error) {
        console.error('Error in find-movies:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Endpoint to get history
app.get('/api/history', async (req, res) => {
    try {
        const history = await loadHistory();
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to download a list
app.get('/api/download/:filename', async (req, res) => {
    try {
        const filepath = path.join(LISTS_DIR, req.params.filename);
        res.download(filepath);
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

// Endpoint to delete a list
app.delete('/api/delete/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = path.join(LISTS_DIR, filename);

        // Read the movie IDs from the file
        const fileContent = await fs.readFile(filepath, 'utf8');
        const movieIds = fileContent.split('\n').filter(id => id.trim()).map(id => parseInt(id.trim()));

        // Load global IDs and remove these IDs
        const globalIds = await loadGlobalIds();
        movieIds.forEach(id => globalIds.delete(id));
        await saveGlobalIds(globalIds);

        // Delete the file
        await fs.unlink(filepath);

        // Remove from history
        const history = await loadHistory();
        const updatedHistory = history.filter(item => item.filename !== filename);
        await saveHistory(updatedHistory);

        res.json({ success: true, message: 'List deleted and IDs removed from global deduplication' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Torrent conversion endpoints

// Endpoint to convert movie lists to torrents
app.post('/api/convert-to-torrents', async (req, res) => {
    const { filenames, quality = '1080p', forceQuality = false } = req.body;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // Collect all TMDB IDs from selected files
        const allTmdbIds = new Set();
        for (const filename of filenames) {
            const filepath = path.join(LISTS_DIR, filename);
            const content = await fs.readFile(filepath, 'utf8');
            const ids = content.split('\n')
                .filter(id => id.trim())
                .map(id => parseInt(id.trim()));
            ids.forEach(id => allTmdbIds.add(id));
        }

        const movieIds = [...allTmdbIds];
        const results = [];
        const errors = [];
        let processed = 0;
        let totalSizeBytes = 0;

        for (const tmdbId of movieIds) {
            // Get movie details (title, year) from TMDB
            const details = await getMovieDetails(tmdbId);

            if (!details) {
                errors.push({
                    tmdbId: tmdbId,
                    imdbId: null,
                    title: 'Unknown',
                    year: 'Unknown',
                    error: 'Failed to fetch movie details'
                });
                processed++;
                res.write(`data: ${JSON.stringify({
                    processed,
                    total: movieIds.length,
                    current: tmdbId,
                    status: 'error_details',
                    totalSize: formatBytes(totalSizeBytes)
                })}\n\n`);
                continue;
            }

            // Get IMDB ID
            const imdbId = await getImdbId(tmdbId);
            await new Promise(resolve => setTimeout(resolve, 250)); // Rate limit TMDB

            let selectedTorrent = null;
            let magnetLink = null;
            let fallbackUsed = null;

            // TIER 1: Try YTS API with IMDB ID
            if (imdbId) {
                const ytsMovie = await searchYtsTorrents(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300)); // Rate limit YTS

                if (ytsMovie && ytsMovie.torrents && ytsMovie.torrents.length > 0) {
                    selectedTorrent = selectBestTorrent(ytsMovie.torrents, quality, forceQuality);
                    if (selectedTorrent) {
                        magnetLink = constructMagnetLink(
                            selectedTorrent.hash,
                            `${details.title} ${details.year} ${selectedTorrent.quality}`
                        );
                        fallbackUsed = 'YTS_API';
                    }
                }
            }

            // TIER 2: Try YTS page scraping with IMDB title/year
            if (!selectedTorrent && imdbId) {
                // Get accurate title/year from IMDB
                const imdbInfo = await getImdbMovieInfo(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (imdbInfo) {
                    const ytsTorrents = await scrapeYtsMovie(imdbInfo.title, imdbInfo.year);
                    await new Promise(resolve => setTimeout(resolve, 300));

                    if (ytsTorrents && ytsTorrents.length > 0) {
                        // Find preferred quality
                        selectedTorrent = ytsTorrents.find(t => t.quality === quality);
                        if (!selectedTorrent && !forceQuality) {
                            selectedTorrent = ytsTorrents[0]; // Fallback to first available (only if not forcing quality)
                        }

                        if (selectedTorrent) {
                            magnetLink = selectedTorrent.magnetLink;
                            fallbackUsed = 'YTS_SCRAPE';
                        }
                    }
                }
            }

            // TIER 2.5: Try TorrentDownloads.pro first, then TorrentDownload.info as fallback
            if (!selectedTorrent) {
                // Use IMDB title/year if available, otherwise TMDB
                let searchTitle = details.title;
                let searchYear = details.year;

                if (imdbId) {
                    const imdbInfo = await getImdbMovieInfo(imdbId);
                    if (imdbInfo) {
                        searchTitle = imdbInfo.title;
                        searchYear = imdbInfo.year;
                    }
                }

                // Try TorrentDownloads.pro first (currently working)
                const torrentDownloadsProResult = await scrapeTorrentDownloadsPro(searchTitle, searchYear, quality);
                await new Promise(resolve => setTimeout(resolve, 400));

                if (torrentDownloadsProResult) {
                    selectedTorrent = torrentDownloadsProResult;
                    magnetLink = torrentDownloadsProResult.magnetLink;
                    fallbackUsed = 'TORRENTDOWNLOADS.PRO';
                } else {
                    // Fallback to TorrentDownload.info (in case it comes back online)
                    const torrentDownloadResult = await scrapeTorrentDownload(searchTitle, searchYear, quality);
                    await new Promise(resolve => setTimeout(resolve, 400));

                    if (torrentDownloadResult) {
                        selectedTorrent = torrentDownloadResult;
                        magnetLink = torrentDownloadResult.magnetLink;
                        fallbackUsed = 'TORRENTDOWNLOAD.INFO';
                    }
                }
            }

            // TIER 3: Try Torrent-Api-py multiple sites
            if (!selectedTorrent) {
                // Use IMDB title/year if available, otherwise TMDB
                let searchTitle = details.title;
                let searchYear = details.year;

                if (imdbId) {
                    const imdbInfo = await getImdbMovieInfo(imdbId);
                    if (imdbInfo) {
                        searchTitle = imdbInfo.title;
                        searchYear = imdbInfo.year;
                    }
                }

                const apiResult = await searchTorrentApiPy(searchTitle, searchYear, quality);
                await new Promise(resolve => setTimeout(resolve, 500));

                if (apiResult) {
                    selectedTorrent = apiResult;
                    magnetLink = apiResult.magnetLink;
                    fallbackUsed = `API_${apiResult.source.toUpperCase()}`;
                }
            }

            // If still no torrent found, add to errors
            if (!selectedTorrent || !magnetLink) {
                errors.push({
                    tmdbId: tmdbId,
                    imdbId: imdbId || 'N/A',
                    title: details.title,
                    year: details.year,
                    error: 'Not found on any source (YTS API, YTS scrape, TorrentDownloads.pro, TorrentDownload.info, Torrent-Api-py sites)'
                });
                processed++;
                res.write(`data: ${JSON.stringify({
                    processed,
                    total: movieIds.length,
                    current: details.title,
                    status: 'error_not_found',
                    totalSize: formatBytes(totalSizeBytes)
                })}\n\n`);
                continue;
            }

            // Add size to total
            if (selectedTorrent.size) {
                totalSizeBytes += sizeToBytes(selectedTorrent.size);
            }

            results.push({
                tmdbId: tmdbId,
                imdbId: imdbId || 'N/A',
                title: details.title,
                year: details.year,
                quality: selectedTorrent.quality,
                size: selectedTorrent.size || 'Unknown',
                magnetLink: magnetLink,
                source: fallbackUsed
            });

            processed++;
            res.write(`data: ${JSON.stringify({
                processed,
                total: movieIds.length,
                current: details.title,
                status: 'success',
                source: fallbackUsed,
                totalSize: formatBytes(totalSizeBytes)
            })}\n\n`);
        }

        // Create timestamp and filenames
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const baseFilename = `torrents_${Date.now()}`;
        const resultsFilename = `${baseFilename}.txt`;
        const errorsFilename = `${baseFilename}_errors.txt`;

        // Write results file
        const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);
        let resultsContent = 'Movie Name\tMagnet Link\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tQuality\tSize\n';
        resultsContent += results.map(r =>
            `${r.title}\t${r.magnetLink}\t${r.title}\t${r.imdbId}\t${r.tmdbId}\t${r.year}\t${r.quality}\t${r.size}`
        ).join('\n');
        await fs.writeFile(resultsPath, resultsContent);

        // Write errors file if there are errors
        let errorsFilenameResult = null;
        if (errors.length > 0) {
            const errorsPath = path.join(TORRENT_LISTS_DIR, errorsFilename);
            let errorsContent = 'Status\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tError\n';
            errorsContent += errors.map(e =>
                `MISSING\t${e.title}\t${e.imdbId || 'N/A'}\t${e.tmdbId}\t${e.year}\t${e.error}`
            ).join('\n');
            await fs.writeFile(errorsPath, errorsContent);
            errorsFilenameResult = errorsFilename;
        }

        // Update history
        const history = await loadTorrentHistory();
        history.push({
            resultsFilename: resultsFilename,
            errorsFilename: errorsFilenameResult,
            date: timestamp,
            successCount: results.length,
            errorCount: errors.length,
            totalCount: movieIds.length,
            quality: quality,
            sourceFiles: filenames,
            totalSize: formatBytes(totalSizeBytes),
            totalSizeBytes: totalSizeBytes
        });
        await saveTorrentHistory(history);

        // Send completion
        res.write(`data: ${JSON.stringify({
            complete: true,
            successCount: results.length,
            errorCount: errors.length,
            totalCount: movieIds.length,
            resultsFilename: resultsFilename,
            errorsFilename: errorsFilenameResult,
            timestamp: timestamp,
            totalSize: formatBytes(totalSizeBytes)
        })}\n\n`);

        res.end();
    } catch (error) {
        console.error('Error in convert-to-torrents:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Endpoint to get available movie lists
app.get('/api/movie-lists', async (req, res) => {
    try {
        const files = await fs.readdir(LISTS_DIR);
        const txtFiles = files.filter(f => f.endsWith('.txt'));

        const lists = await Promise.all(txtFiles.map(async (filename) => {
            const filepath = path.join(LISTS_DIR, filename);
            const content = await fs.readFile(filepath, 'utf8');
            const count = content.split('\n').filter(id => id.trim()).length;

            return {
                filename: filename,
                displayName: filename.replace('movies_', '').replace('.txt', ''),
                count: count
            };
        }));

        res.json(lists);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get torrent conversion history
app.get('/api/torrent-history', async (req, res) => {
    try {
        const history = await loadTorrentHistory();

        // Recalculate size and count from actual results files
        for (const item of history) {
            try {
                const resultsPath = path.join(TORRENT_LISTS_DIR, item.resultsFilename);
                const content = await fs.readFile(resultsPath, 'utf8');
                const lines = content.split('\n').slice(1).filter(l => l.trim()); // Skip header

                // Recalculate success count
                item.successCount = lines.length;

                // Recalculate total size
                let totalBytes = 0;
                for (const line of lines) {
                    const parts = line.split('\t');
                    if (parts.length >= 8) {
                        const size = parts[7]; // Size is 8th column
                        totalBytes += sizeToBytes(size);
                    }
                }
                item.totalSize = formatBytes(totalBytes);
                item.totalSizeBytes = totalBytes;
            } catch (err) {
                // If file doesn't exist or can't be read, keep original values
                console.log(`Could not recalculate size for ${item.resultsFilename}: ${err.message}`);
            }
        }

        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to download torrent list file
app.get('/api/download-torrent/:filename', async (req, res) => {
    try {
        const filepath = path.join(TORRENT_LISTS_DIR, req.params.filename);
        res.download(filepath);
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

// Endpoint to manually add magnet link to error file
app.post('/api/add-manual-magnet', async (req, res) => {
    try {
        const { errorsFilename, tmdbId, magnetLink, quality, size } = req.body;

        // Get corresponding results filename
        const resultsFilename = errorsFilename.replace('_errors.txt', '.txt');
        const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);
        const errorsPath = path.join(TORRENT_LISTS_DIR, errorsFilename);

        // Read errors file to get movie details
        let errorsContent = await fs.readFile(errorsPath, 'utf8');
        const errorsLines = errorsContent.split('\n');

        let movieTitle, imdbId, year, errorLine;

        // Find the movie in errors file
        for (let i = 0; i < errorsLines.length; i++) {
            if (errorsLines[i].includes(`\t${tmdbId}\t`)) {
                const parts = errorsLines[i].split('\t');
                // Format: Status | Title | IMDB ID | TMDB ID | Release Year | Error
                movieTitle = parts[1];
                imdbId = parts[2] === 'N/A' ? `tt${tmdbId}` : parts[2];
                year = parts[4];
                errorLine = i;

                // REMOVE the error line entirely (splice it out)
                errorsLines.splice(i, 1);
                break;
            }
        }

        if (!movieTitle) {
            throw new Error('Movie not found in errors file');
        }

        // Add to results file
        // Format: Movie Name | Magnet Link | Title | IMDB ID | TMDB ID | Release Year | Quality | Size
        const movieName = formatMovieName(movieTitle, year, quality || '1080p');
        const newResultLine = `${movieName}\t${magnetLink}\t${movieTitle}\t${imdbId}\t${tmdbId}\t${year}\t${quality || '1080p'}\t${size || 'Unknown'}`;

        // Read and append to results file
        let resultsContent = '';
        try {
            resultsContent = await fs.readFile(resultsPath, 'utf8');
        } catch (err) {
            // If results file doesn't exist, create with header
            resultsContent = 'Movie Name\tMagnet Link\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tQuality\tSize\n';
        }

        // Append new result
        resultsContent += newResultLine + '\n';
        await fs.writeFile(resultsPath, resultsContent);

        // Write updated errors file (without the removed line)
        await fs.writeFile(errorsPath, errorsLines.join('\n'));

        console.log(`[MANUAL ADD] Added "${movieTitle}" to ${resultsFilename} and removed from errors`);

        res.json({ success: true, movieName });
    } catch (error) {
        console.error('[MANUAL ADD ERROR]:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to delete torrent conversion entry
app.delete('/api/delete-torrent/:resultsFilename', async (req, res) => {
    try {
        const resultsFilename = req.params.resultsFilename;

        // Load history to find the entry
        const history = await loadTorrentHistory();
        const entry = history.find(h => h.resultsFilename === resultsFilename);

        if (!entry) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        // Delete results file
        const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);
        try {
            await fs.unlink(resultsPath);
        } catch (err) {
            console.log(`Results file ${resultsFilename} already deleted or not found`);
        }

        // Delete errors file if it exists
        if (entry.errorsFilename) {
            const errorsPath = path.join(TORRENT_LISTS_DIR, entry.errorsFilename);
            try {
                await fs.unlink(errorsPath);
            } catch (err) {
                console.log(`Errors file ${entry.errorsFilename} already deleted or not found`);
            }
        }

        // Remove from history
        const updatedHistory = history.filter(h => h.resultsFilename !== resultsFilename);
        await saveTorrentHistory(updatedHistory);

        res.json({ success: true, message: 'Torrent conversion deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Start refresh job (background processing)
app.post('/api/refresh-missing/start', async (req, res) => {
    try {
        const { errorsFilename, resultsFilename, quality = '1080p', forceQuality = false } = req.body;

        // Check if already running
        const existingJob = Array.from(activeRefreshJobs.values())
            .find(job => job.resultsFilename === resultsFilename && job.status === 'running');

        if (existingJob) {
            return res.json({ jobId: existingJob.jobId, message: 'Already running', status: 'existing' });
        }

        // Create job ID
        const jobId = `refresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Initialize job state
        activeRefreshJobs.set(jobId, {
            jobId,
            errorsFilename,
            resultsFilename,
            quality,
            forceQuality: forceQuality || false,
            status: 'running',
            processed: 0,
            total: 0,
            current: 'Starting...',
            newlyFound: 0,
            stillMissing: 0,
            startTime: Date.now(),
            endTime: null,
            error: null
        });

        // Start async processing (non-blocking)
        processRefreshJob(jobId).catch(err => {
            console.error(`Error starting job ${jobId}:`, err);
            const job = activeRefreshJobs.get(jobId);
            if (job) {
                job.status = 'error';
                job.error = err.message;
                job.endTime = Date.now();
            }
        });

        // Return immediately
        res.json({ jobId, message: 'Started', status: 'started' });
    } catch (error) {
        console.error('Error starting refresh job:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Get refresh job progress
app.get('/api/refresh-missing/progress/:jobId', (req, res) => {
    try {
        const { jobId } = req.params;
        const job = activeRefreshJobs.get(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json(job);
    } catch (error) {
        console.error('Error getting job progress:', error);
        res.status(500).json({ error: error.message });
    }
});

// NEW: Cancel refresh job
app.post('/api/refresh-missing/cancel/:jobId', (req, res) => {
    try {
        const { jobId } = req.params;

        if (!activeRefreshJobs.has(jobId)) {
            return res.status(404).json({ error: 'Job not found' });
        }

        activeRefreshJobs.delete(jobId);
        res.json({ message: 'Cancelled', status: 'cancelled' });
    } catch (error) {
        console.error('Error cancelling job:', error);
        res.status(500).json({ error: error.message });
    }
});

// OLD: Refresh missing movies - rescan with fallback methods (SSE - DEPRECATED, kept for backward compatibility)
app.post('/api/refresh-missing', async (req, res) => {
    try {
        const { errorsFilename, resultsFilename, quality = '1080p', forceQuality = false } = req.body;

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Read error file
        const errorsPath = path.join(TORRENT_LISTS_DIR, errorsFilename);
        const errorsContent = await fs.readFile(errorsPath, 'utf8');
        const errorLines = errorsContent.split('\n').slice(1); // Skip header

        // Filter valid lines
        const validLines = errorLines.filter(line =>
            line.trim() && !line.startsWith('MANUAL')
        );

        let stillMissing = [];
        let newlyFound = [];
        let additionalSizeBytes = 0;
        let processed = 0;

        // Send initial progress
        res.write(`data: ${JSON.stringify({
            processed: 0,
            total: validLines.length,
            status: 'starting',
            newlyFound: 0,
            stillMissing: 0
        })}\n\n`);

        for (const line of validLines) {
            const parts = line.split('\t');
            if (parts.length < 5) continue;

            const title = parts[1];
            const imdbId = parts[2] !== 'N/A' ? parts[2] : null;
            const tmdbId = parseInt(parts[3]);
            const year = parts[4];

            let selectedTorrent = null;
            let magnetLink = null;
            let fallbackUsed = null;

            // TIER 1: Try YTS API
            if (imdbId) {
                const ytsMovie = await searchYtsTorrents(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (ytsMovie && ytsMovie.torrents && ytsMovie.torrents.length > 0) {
                    selectedTorrent = selectBestTorrent(ytsMovie.torrents, quality, forceQuality);
                    if (selectedTorrent) {
                        magnetLink = constructMagnetLink(
                            selectedTorrent.hash,
                            `${title} ${year} ${selectedTorrent.quality}`
                        );
                        fallbackUsed = 'YTS_API';
                    }
                }
            }

            // TIER 2: Try YTS page scraping
            if (!selectedTorrent && imdbId) {
                const imdbInfo = await getImdbMovieInfo(imdbId);
                await new Promise(resolve => setTimeout(resolve, 300));

                if (imdbInfo) {
                    const ytsTorrents = await scrapeYtsMovie(imdbInfo.title, imdbInfo.year);
                    await new Promise(resolve => setTimeout(resolve, 300));

                    if (ytsTorrents && ytsTorrents.length > 0) {
                        selectedTorrent = ytsTorrents.find(t => t.quality === quality);
                        if (!selectedTorrent && !forceQuality) selectedTorrent = ytsTorrents[0];

                        if (selectedTorrent) {
                            magnetLink = selectedTorrent.magnetLink;
                            fallbackUsed = 'YTS_SCRAPE';
                        }
                    }
                }
            }

            // TIER 3: Try Torrent-Api-py multiple sites
            if (!selectedTorrent) {
                let searchTitle = title;
                let searchYear = year;

                if (imdbId) {
                    const imdbInfo = await getImdbMovieInfo(imdbId);
                    if (imdbInfo) {
                        searchTitle = imdbInfo.title;
                        searchYear = imdbInfo.year;
                    }
                }

                const apiResult = await searchTorrentApiPy(searchTitle, searchYear, quality);
                await new Promise(resolve => setTimeout(resolve, 500));

                if (apiResult) {
                    selectedTorrent = apiResult;
                    magnetLink = apiResult.magnetLink;
                    fallbackUsed = `API_${apiResult.source.toUpperCase()}`;
                }
            }

            // Categorize result and ADD LIVE TO RESULTS
            if (selectedTorrent && magnetLink) {
                const foundMovie = {
                    tmdbId,
                    imdbId: imdbId || 'N/A',
                    title,
                    year,
                    quality: selectedTorrent.quality,
                    size: selectedTorrent.size || 'Unknown',
                    magnetLink,
                    source: fallbackUsed
                };

                newlyFound.push(foundMovie);

                if (selectedTorrent.size) {
                    additionalSizeBytes += sizeToBytes(selectedTorrent.size);
                }

                // IMMEDIATELY add to results file (LIVE UPDATE)
                const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);
                const newLine = `${foundMovie.title}\t${foundMovie.magnetLink}\t${foundMovie.title}\t${foundMovie.imdbId}\t${foundMovie.tmdbId}\t${foundMovie.year}\t${foundMovie.quality}\t${foundMovie.size}`;
                await fs.appendFile(resultsPath, '\n' + newLine);

                // IMMEDIATELY remove from error list (LIVE UPDATE)
                const errorsPath = path.join(TORRENT_LISTS_DIR, errorsFilename);
                const errorsContent = await fs.readFile(errorsPath, 'utf8');
                const errorsLines = errorsContent.split('\n');
                const errorsHeader = errorsLines[0];
                const errorsData = errorsLines.slice(1).filter(l => l.trim());

                // Remove this specific movie from errors
                const updatedErrors = errorsData.filter(line => {
                    const parts = line.split('\t');
                    if (parts.length >= 5) {
                        const eTmdbId = parts[3];
                        const eYear = parts[4];
                        return !(eTmdbId === String(tmdbId) && eYear === year);
                    }
                    return true;
                });

                stillMissing = updatedErrors;

                // Write updated errors immediately
                const newErrorsContent = errorsHeader + '\n' + updatedErrors.join('\n');
                await fs.writeFile(errorsPath, newErrorsContent);
            } else {
                stillMissing.push(line);
            }

            // Send progress update
            processed++;
            res.write(`data: ${JSON.stringify({
                processed,
                total: validLines.length,
                current: title,
                status: selectedTorrent ? 'found' : 'not_found',
                newlyFound: newlyFound.length,
                stillMissing: stillMissing.length
            })}\n\n`);
        }

        // Files already updated live, just need final cleanup

        // Update errors file
        const errorsHeader = 'Status\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tError\n';
        const newErrorsContent = errorsHeader + stillMissing.join('\n');
        await fs.writeFile(errorsPath, newErrorsContent);

        // Update history with new size
        const history = await loadTorrentHistory();
        const entry = history.find(h => h.resultsFilename === resultsFilename);
        if (entry) {
            entry.successCount += newlyFound.length;
            entry.errorCount = stillMissing.length;
            entry.totalSizeBytes = (entry.totalSizeBytes || 0) + additionalSizeBytes;
            entry.totalSize = formatBytes(entry.totalSizeBytes);
            await saveTorrentHistory(history);
        }

        // Send completion message
        res.write(`data: ${JSON.stringify({
            complete: true,
            newlyFound: newlyFound.length,
            stillMissing: stillMissing.length,
            additionalSize: formatBytes(additionalSizeBytes),
            newTotalSize: entry ? entry.totalSize : 'Unknown'
        })}\n\n`);

        res.end();
    } catch (error) {
        console.error('Error refreshing missing movies:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Download client endpoints

// Get available client types
app.get('/api/client-types', (req, res) => {
    res.json(CLIENT_CONFIGS);
});

// Test download client connection
app.post('/api/test-download-client', async (req, res) => {
    try {
        const { type, host, port, username, password, ssl } = req.body;

        // Create temporary config for testing
        const tempConfig = {
            type,
            host,
            port,
            username,
            password: encryptPassword(password), // Encrypt for testing
            ssl: ssl || false
        };

        const client = createTorrentClient(tempConfig);
        const result = await client.testConnection();

        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save download client configuration
app.post('/api/download-clients', async (req, res) => {
    try {
        const { id, type, name, host, port, username, password, ssl } = req.body;

        const clients = await loadDownloadClients();

        const clientConfig = {
            id: id || `client-${Date.now()}`,
            type,
            name,
            host,
            port,
            username,
            password: encryptPassword(password),
            ssl: ssl || false,
            enabled: true,
            createdAt: new Date().toISOString()
        };

        // Update existing or add new
        const existingIndex = clients.findIndex(c => c.id === clientConfig.id);
        if (existingIndex !== -1) {
            clients[existingIndex] = clientConfig;
        } else {
            clients.push(clientConfig);
        }

        await saveDownloadClients(clients);

        res.json({
            success: true,
            clientId: clientConfig.id,
            message: 'Client saved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint to manually add movie ID to list
app.post('/api/add-movie-id', async (req, res) => {
    try {
        const { movieId, listType, targetList } = req.body;

        if (!movieId || !listType || !targetList) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters'
            });
        }

        if (listType === 'movie') {
            // Add to movie list
            const filepath = path.join(LISTS_DIR, targetList);
            const content = await fs.readFile(filepath, 'utf8');
            const ids = content.split('\n').filter(id => id.trim());

            // Check for exact duplicate
            if (ids.includes(movieId)) {
                return res.json({
                    success: false,
                    error: 'ID already exists in this list'
                });
            }

            // Check for cross-ID duplicates (IMDB vs TMDB)
            let tmdbId = null;
            let imdbId = null;

            if (movieId.startsWith('tt')) {
                // Adding IMDB ID - check if equivalent TMDB ID exists
                imdbId = movieId;
                try {
                    const response = await axios.get(
                        `https://api.themoviedb.org/3/find/${imdbId}`,
                        {
                            params: {
                                api_key: TMDB_API_KEY,
                                external_source: 'imdb_id'
                            }
                        }
                    );
                    if (response.data.movie_results && response.data.movie_results.length > 0) {
                        tmdbId = response.data.movie_results[0].id.toString();
                        if (ids.includes(tmdbId)) {
                            return res.json({
                                success: false,
                                error: `Equivalent TMDB ID (${tmdbId}) already exists in this list`
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error checking for TMDB equivalent:', error.message);
                }
            } else {
                // Adding TMDB ID - check if equivalent IMDB ID exists
                tmdbId = movieId;
                imdbId = await getImdbId(tmdbId);
                if (imdbId && ids.includes(imdbId)) {
                    return res.json({
                        success: false,
                        error: `Equivalent IMDB ID (${imdbId}) already exists in this list`
                    });
                }
            }

            // Append the new ID
            ids.push(movieId);
            await fs.writeFile(filepath, ids.join('\n'));

            res.json({
                success: true,
                message: `Added ${movieId} to movie list`
            });

        } else if (listType === 'torrent') {
            // Add to torrent list - need to search for torrent first
            const resultsPath = path.join(TORRENT_LISTS_DIR, targetList);

            // Determine if this is IMDB or TMDB ID
            let imdbId = null;
            let tmdbId = null;

            if (movieId.startsWith('tt')) {
                imdbId = movieId;
                // Try to get TMDB ID from IMDB
                try {
                    const response = await axios.get(
                        `https://api.themoviedb.org/3/find/${imdbId}`,
                        {
                            params: {
                                api_key: TMDB_API_KEY,
                                external_source: 'imdb_id'
                            }
                        }
                    );
                    if (response.data.movie_results && response.data.movie_results.length > 0) {
                        tmdbId = response.data.movie_results[0].id;
                    }
                } catch (error) {
                    console.error('Error getting TMDB ID from IMDB:', error.message);
                }
            } else {
                tmdbId = movieId;
                // Get IMDB ID from TMDB
                imdbId = await getImdbId(tmdbId);
            }

            if (!imdbId) {
                return res.json({
                    success: false,
                    error: 'Could not find IMDB ID for this movie'
                });
            }

            // Get movie details
            let movieDetails = null;
            if (tmdbId) {
                const response = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
                    params: { api_key: TMDB_API_KEY }
                });
                movieDetails = {
                    title: response.data.title,
                    year: response.data.release_date ? response.data.release_date.split('-')[0] : 'Unknown'
                };
            }

            if (!movieDetails) {
                return res.json({
                    success: false,
                    error: 'Could not fetch movie details'
                });
            }

            // Search for torrent
            const torrentResult = await searchTorrentMultiSource(imdbId, movieDetails.title, movieDetails.year);

            if (!torrentResult) {
                return res.json({
                    success: false,
                    error: 'No torrent found for this movie'
                });
            }

            // Read existing torrent list
            const content = await fs.readFile(resultsPath, 'utf8');
            const lines = content.split('\n');
            const header = lines[0];
            const existingEntries = lines.slice(1).filter(l => l.trim());

            // Check for duplicates
            const isDuplicate = existingEntries.some(line => {
                const parts = line.split('\t');
                return parts[2] === imdbId || (tmdbId && parts[3] === tmdbId.toString());
            });

            if (isDuplicate) {
                return res.json({
                    success: false,
                    error: 'Movie already exists in torrent list'
                });
            }

            // Add new entry
            const quality = torrentResult.quality || 'Unknown';
            const sizeBytes = torrentResult.size_bytes || 0;
            const newEntry = `SUCCESS\t${movieDetails.title}\t${imdbId}\t${tmdbId || 'N/A'}\t${movieDetails.year}\t${quality}\t${formatBytes(sizeBytes)}\t${torrentResult.magnet}`;

            existingEntries.push(newEntry);
            await fs.writeFile(resultsPath, header + '\n' + existingEntries.join('\n'));

            // Update history counts
            const history = await loadTorrentHistory();
            const historyEntry = history.find(h => h.resultsFilename === targetList);
            if (historyEntry) {
                historyEntry.successCount = existingEntries.length;
                historyEntry.totalCount = existingEntries.length;
                await saveTorrentHistory(history);
            }

            res.json({
                success: true,
                message: `Added ${movieDetails.title} (${movieDetails.year}) to torrent list`,
                torrentDetails: {
                    title: movieDetails.title,
                    year: movieDetails.year,
                    quality: quality
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid list type'
            });
        }

    } catch (error) {
        console.error('Error adding movie ID:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint to combine multiple torrent conversions
app.post('/api/combine-conversions', async (req, res) => {
    try {
        const { files } = req.body;

        if (!files || !Array.isArray(files) || files.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'At least 2 files required for combining'
            });
        }

        // Read all selected files
        const allEntries = [];
        const sourceFiles = [];
        let totalQuality = '';

        for (const filename of files) {
            const filepath = path.join(TORRENT_LISTS_DIR, filename);
            const content = await fs.readFile(filepath, 'utf8');
            const lines = content.split('\n');

            // Skip header (first line)
            const entries = lines.slice(1).filter(l => l.trim());

            // Parse entries
            entries.forEach(entry => {
                const parts = entry.split('\t');
                if (parts.length >= 8) {
                    // Match actual format: Movie Name, Magnet, Title, IMDB, TMDB, Year, Quality, Size
                    const [movieName, magnet, title, imdbId, tmdbId, year, quality, size] = parts;

                    // Validate entry has required fields
                    if (title && magnet && tmdbId) {
                        allEntries.push({
                            title,
                            imdbId,
                            tmdbId,
                            year,
                            quality,
                            size,
                            magnet,
                            // Create unique key for deduplication
                            key: `${tmdbId}-${year}-${quality}`
                        });
                    }
                }
            });

            sourceFiles.push(filename);

            // Get quality from history
            const history = await loadTorrentHistory();
            const historyEntry = history.find(h => h.resultsFilename === filename);
            if (historyEntry && historyEntry.quality) {
                if (!totalQuality) {
                    totalQuality = historyEntry.quality;
                } else if (totalQuality !== historyEntry.quality) {
                    totalQuality = 'Mixed';
                }
            }
        }

        // Deduplicate using Set with custom key
        const uniqueEntries = [];
        const seenKeys = new Set();

        for (const entry of allEntries) {
            if (!seenKeys.has(entry.key)) {
                seenKeys.add(entry.key);
                uniqueEntries.push(entry);
            }
        }

        const totalCount = allEntries.length;
        const uniqueCount = uniqueEntries.length;
        const duplicatesRemoved = totalCount - uniqueCount;

        // Create timestamp and filename
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const resultsFilename = `torrents_combined_${Date.now()}.txt`;
        const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFilename);

        // Create file content
        let fileContent = 'Status\tTitle\tIMDB ID\tTMDB ID\tRelease Year\tQuality\tSize\tMagnet Link\n';

        // Calculate total size
        let totalSizeBytes = 0;
        uniqueEntries.forEach(entry => {
            fileContent += `SUCCESS\t${entry.title}\t${entry.imdbId}\t${entry.tmdbId}\t${entry.year}\t${entry.quality}\t${entry.size}\t${entry.magnet}\n`;

            // Parse size back to bytes for total calculation
            const sizeMatch = entry.size.match(/([\d.]+)\s*(GB|MB)/i);
            if (sizeMatch) {
                const value = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2].toUpperCase();
                if (unit === 'GB') {
                    totalSizeBytes += value * 1024 * 1024 * 1024;
                } else if (unit === 'MB') {
                    totalSizeBytes += value * 1024 * 1024;
                }
            }
        });

        // Save combined file
        await fs.writeFile(resultsPath, fileContent);

        // Update history
        const history = await loadTorrentHistory();
        history.push({
            resultsFilename: resultsFilename,
            errorsFilename: null,
            date: timestamp,
            successCount: uniqueCount,
            errorCount: 0,
            totalCount: uniqueCount,
            quality: totalQuality || 'Mixed',
            sourceFiles: sourceFiles,
            totalSize: formatBytes(totalSizeBytes),
            totalSizeBytes: totalSizeBytes
        });
        await saveTorrentHistory(history);

        res.json({
            success: true,
            resultsFilename: resultsFilename,
            totalCount: totalCount,
            uniqueCount: uniqueCount,
            duplicatesRemoved: duplicatesRemoved,
            timestamp: timestamp
        });

    } catch (error) {
        console.error('Error combining conversions:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all configured download clients
app.get('/api/download-clients', async (req, res) => {
    try {
        const clients = await loadDownloadClients();

        // Return clients without passwords
        const safeClients = clients.map(c => ({
            id: c.id,
            type: c.type,
            name: c.name,
            host: c.host,
            port: c.port,
            username: c.username,
            ssl: c.ssl,
            enabled: c.enabled,
            createdAt: c.createdAt
        }));

        res.json(safeClients);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete download client
app.delete('/api/download-clients/:id', async (req, res) => {
    try {
        const clientId = req.params.id;
        const clients = await loadDownloadClients();

        const updatedClients = clients.filter(c => c.id !== clientId);

        if (updatedClients.length === clients.length) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        await saveDownloadClients(updatedClients);

        res.json({
            success: true,
            message: 'Client deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Send torrents to download client
app.post('/api/send-to-client', async (req, res) => {
    try {
        const { clientId, torrentFilename, category } = req.body;

        // Load client config
        const clients = await loadDownloadClients();
        const clientConfig = clients.find(c => c.id === clientId);

        if (!clientConfig) {
            return res.status(404).json({
                success: false,
                error: 'Client not found'
            });
        }

        // Create client instance
        const client = createTorrentClient(clientConfig);

        // Read torrent file
        const torrentPath = path.join(TORRENT_LISTS_DIR, torrentFilename);
        const content = await fs.readFile(torrentPath, 'utf8');
        const lines = content.split('\n').slice(1); // Skip header

        let added = 0;
        let failed = 0;
        const errors = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const parts = line.split('\t');
            if (parts.length < 8) continue;

            const title = parts[2];
            const magnetLink = parts[1];
            const year = parts[5];
            const quality = parts[6];

            // Format name for download client
            const formattedName = formatMovieName(title, year, quality);

            // Add torrent to client
            const result = await client.addTorrent(magnetLink, {
                name: formattedName,
                category: category || ''
            });

            if (result.success) {
                added++;

                // Start background worker to rename files/folders after metadata is downloaded
                // Don't await - let it run in background
                waitAndRenameTorrent(client, magnetLink, formattedName).catch(err => {
                    console.error(`[RENAME] Background worker error for ${formattedName}:`, err.message);
                });
            } else {
                failed++;
                errors.push({
                    title: title,
                    error: result.error || 'Unknown error'
                });
            }

            // Small delay to avoid overwhelming the client
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        res.json({
            success: true,
            added,
            failed,
            errors
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clean up duplicates in torrent lists
app.post('/api/cleanup-duplicates', async (req, res) => {
    try {
        const results = {
            filesScanned: 0,
            duplicatesRemoved: 0,
            errorsFixed: 0,
            details: []
        };

        // Get all results files
        const files = await fs.readdir(TORRENT_LISTS_DIR);
        const resultsFiles = files.filter(f => f.endsWith('.txt') && !f.endsWith('_errors.txt'));

        for (const resultsFile of resultsFiles) {
            const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFile);
            const errorsPath = path.join(TORRENT_LISTS_DIR, resultsFile.replace('.txt', '_errors.txt'));

            // Read results file
            const resultsContent = await fs.readFile(resultsPath, 'utf8');
            const resultsLines = resultsContent.split('\n');
            const resultsHeader = resultsLines[0];
            const resultsData = resultsLines.slice(1).filter(l => l.trim());

            // Track duplicates in results by TMDB ID + Year + Quality
            const seen = new Set();
            const uniqueResults = [];
            let duplicatesInFile = 0;

            for (const line of resultsData) {
                const parts = line.split('\t');
                if (parts.length < 8) continue;

                const tmdbId = parts[4]; // TMDB ID
                const year = parts[5];   // Year
                const quality = parts[6]; // Quality
                const key = `${tmdbId}-${year}-${quality}`;

                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueResults.push(line);
                } else {
                    duplicatesInFile++;
                }
            }

            // Write back results file if duplicates found
            if (duplicatesInFile > 0) {
                const newContent = [resultsHeader, ...uniqueResults].join('\n') + '\n';
                await fs.writeFile(resultsPath, newContent, 'utf8');
                results.duplicatesRemoved += duplicatesInFile;
            }

            // Now check errors file
            try {
                const errorsContent = await fs.readFile(errorsPath, 'utf8');
                const errorsLines = errorsContent.split('\n');
                const errorsHeader = errorsLines[0];
                const errorsData = errorsLines.slice(1).filter(l => l.trim());

                // Build set of TMDB IDs + Years in results
                const resultsKeys = new Set();
                for (const line of uniqueResults) {
                    const parts = line.split('\t');
                    if (parts.length >= 6) {
                        const tmdbId = parts[4];
                        const year = parts[5];
                        resultsKeys.add(`${tmdbId}-${year}`);
                    }
                }

                // Filter out errors that are already in results
                const validErrors = [];
                let errorsFixed = 0;

                for (const line of errorsData) {
                    const parts = line.split('\t');
                    if (parts.length < 5) {
                        validErrors.push(line);
                        continue;
                    }

                    const tmdbId = parts[3]; // TMDB ID in errors file
                    const year = parts[4];    // Year in errors file
                    const key = `${tmdbId}-${year}`;

                    if (!resultsKeys.has(key)) {
                        validErrors.push(line);
                    } else {
                        errorsFixed++;
                    }
                }

                // Write back errors file if changes found
                if (errorsFixed > 0) {
                    const newContent = [errorsHeader, ...validErrors].join('\n') + '\n';
                    await fs.writeFile(errorsPath, newContent, 'utf8');
                    results.errorsFixed += errorsFixed;
                }

                results.details.push({
                    file: resultsFile,
                    duplicatesRemoved: duplicatesInFile,
                    errorsFixed: errorsFixed,
                    remainingResults: uniqueResults.length,
                    remainingErrors: validErrors.length
                });

            } catch (err) {
                // Errors file doesn't exist, skip
                results.details.push({
                    file: resultsFile,
                    duplicatesRemoved: duplicatesInFile,
                    errorsFixed: 0,
                    remainingResults: uniqueResults.length,
                    remainingErrors: 0,
                    note: 'No errors file found'
                });
            }

            results.filesScanned++;
        }

        res.json({
            success: true,
            ...results
        });

    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Automatic cleanup function
async function runAutomaticCleanup() {
    try {
        console.log('[CLEANUP] Running automatic duplicate cleanup...');

        const results = {
            filesScanned: 0,
            duplicatesRemoved: 0,
            errorsFixed: 0
        };

        const files = await fs.readdir(TORRENT_LISTS_DIR);
        const resultsFiles = files.filter(f => f.endsWith('.txt') && !f.endsWith('_errors.txt'));

        for (const resultsFile of resultsFiles) {
            const resultsPath = path.join(TORRENT_LISTS_DIR, resultsFile);
            const errorsPath = path.join(TORRENT_LISTS_DIR, resultsFile.replace('.txt', '_errors.txt'));

            // Read results file
            const resultsContent = await fs.readFile(resultsPath, 'utf8');
            const resultsLines = resultsContent.split('\n');
            const resultsHeader = resultsLines[0];
            const resultsData = resultsLines.slice(1).filter(l => l.trim());

            // Track duplicates
            const seen = new Set();
            const uniqueResults = [];
            let duplicatesInFile = 0;

            for (const line of resultsData) {
                const parts = line.split('\t');
                if (parts.length < 8) continue;

                const tmdbId = parts[4];
                const year = parts[5];
                const quality = parts[6];
                const key = `${tmdbId}-${year}-${quality}`;

                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueResults.push(line);
                } else {
                    duplicatesInFile++;
                }
            }

            // Write back if duplicates found
            if (duplicatesInFile > 0) {
                const newContent = [resultsHeader, ...uniqueResults].join('\n') + '\n';
                await fs.writeFile(resultsPath, newContent, 'utf8');
                results.duplicatesRemoved += duplicatesInFile;
            }

            // Check errors file
            try {
                const errorsContent = await fs.readFile(errorsPath, 'utf8');
                const errorsLines = errorsContent.split('\n');
                const errorsHeader = errorsLines[0];
                const errorsData = errorsLines.slice(1).filter(l => l.trim());

                // Build set of results
                const resultsKeys = new Set();
                for (const line of uniqueResults) {
                    const parts = line.split('\t');
                    if (parts.length >= 6) {
                        const tmdbId = parts[4];
                        const year = parts[5];
                        resultsKeys.add(`${tmdbId}-${year}`);
                    }
                }

                // Filter errors
                const validErrors = [];
                let errorsFixed = 0;

                for (const line of errorsData) {
                    const parts = line.split('\t');
                    if (parts.length < 5) {
                        validErrors.push(line);
                        continue;
                    }

                    const tmdbId = parts[3];
                    const year = parts[4];
                    const key = `${tmdbId}-${year}`;

                    if (!resultsKeys.has(key)) {
                        validErrors.push(line);
                    } else {
                        errorsFixed++;
                    }
                }

                // Write back if errors fixed
                if (errorsFixed > 0) {
                    const newContent = [errorsHeader, ...validErrors].join('\n') + '\n';
                    await fs.writeFile(errorsPath, newContent, 'utf8');
                    results.errorsFixed += errorsFixed;
                }
            } catch (err) {
                // No errors file
            }

            results.filesScanned++;
        }

        console.log(`[CLEANUP] Complete: Scanned ${results.filesScanned} files, removed ${results.duplicatesRemoved} duplicates, fixed ${results.errorsFixed} errors`);
    } catch (error) {
        console.error('[CLEANUP] Error during automatic cleanup:', error.message);
    }
}

// Start server
app.listen(PORT, async () => {
    await initStorage();
    console.log(`TMDB Movie Finder running on http://localhost:${PORT}`);

    // Run cleanup on startup
    console.log('[CLEANUP] Running initial cleanup...');
    await runAutomaticCleanup();

    // Schedule cleanup to run every hour (3600000 ms)
    setInterval(async () => {
        await runAutomaticCleanup();
    }, 3600000);

    console.log('[CLEANUP] Automatic cleanup scheduled to run every hour');
});
