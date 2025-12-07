# TMDB Movie Finder

A powerful movie torrent finder that searches TMDB/IMDB and multiple torrent sources with automatic quality detection and qBittorrent integration.

## Features

- **TMDB/IMDB Integration**: Search movies by title, year, or IMDB ID
- **Multi-Source Torrent Search**: Automatically searches YTS and falls back to multiple torrent sources
- **Quality Detection**: Automatically identifies video quality (4K, 1080p, 720p, etc.)
- **Batch Processing**: Process entire movie lists at once
- **Missing Movie Refresh**: Re-scan movies that didn't find torrents
- **Multiple Concurrent Scans**: Run multiple searches simultaneously without conflicts
- **qBittorrent Integration**: Direct download to qBittorrent WebUI
- **Torrent History**: Save and manage search results
- **Smart Duplicate Detection**: Automatically removes duplicate entries
- **Cross-Tab Synchronization**: Progress updates across multiple browser tabs

## Prerequisites

- **Node.js** >= 16.0.0
- **Python 3** (for Torrent-Api-py backend)
- **TMDB API Key**: You need a free API key from The Movie Database (TMDB) to use this application.
- **qBittorrent** (optional, for download integration)

## How to get a TMDB API Key
1.  Create an account on [themoviedb.org](https://www.themoviedb.org/).
2.  Go to your account settings and click on the "API" tab.
3.  Click on "Create" and choose "Developer" as the type of use.
4.  Fill out the form with your information. You can use "TMDB Movie Finder" as the application name and the repository URL as the application URL.
5.  Once you have your API key, you need to add it to the application.

## Installation

### Windows

1. **Install Node.js**
   - Download from https://nodejs.org/
   - Run installer and follow prompts

2. **Install Python 3**
   - Download from https://www.python.org/downloads/
   - Check "Add Python to PATH" during installation

3. **Clone or download this repository**
   ```cmd
   cd C:\path\to\tmdb-movie-finder-github
   ```

4. **Install dependencies**
   **Important:** You must create your own virtual environment as the one included is not portable.
   ```cmd
   npm install
   cd Torrent-Api-py
   python -m venv api-py
   api-py\Scripts\activate
   pip install -r requirements.txt
   ```

5. **Configure environment**
   - In the root directory of the project, you will find a file named `.env.example`. Make a copy of this file and rename it to `.env`.
   - Open the `.env` file with a text editor.
   - You will see a line that says `TMDB_API_KEY=your_tmdb_api_key_here`. Replace `your_tmdb_api_key_here` with your actual TMDB API key.
   - Save the file.


### macOS

1. **Install Homebrew** (if not installed)
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install Node.js and Python**
   ```bash
   brew install node python3
   ```

3. **Clone or download this repository**
   ```bash
   cd ~/tmdb-movie-finder-github
   ```

4. **Install dependencies**
   **Important:** You must create your own virtual environment as the one included is not portable.
   ```bash
   npm install
   cd Torrent-Api-py
   python3 -m venv api-py
   source api-py/bin/activate
   pip install -r requirements.txt
   ```

5. **Configure environment**
   - In the root directory of the project, you will find a file named `.env.example`. Make a copy of this file and rename it to `.env`.
   - Open the `.env` file with a text editor.
   - You will see a line that says `TMDB_API_KEY=your_tmdb_api_key_here`. Replace `your_tmdb_api_key_here` with your actual TMDB API key.
   - Save the file.


### Linux (Ubuntu/Debian)

1. **Install Node.js and Python**
   ```bash
   sudo apt update
   sudo apt install nodejs npm python3 python3-pip python3-venv
   ```

2. **Clone or download this repository**
   ```bash
   cd ~/tmdb-movie-finder-github
   ```

3. **Install dependencies**
   **Important:** You must create your own virtual environment as the one included is not portable.
   ```bash
   npm install
   cd Torrent-Api-py
   python3 -m venv api-py
   source api-py/bin/activate
   pip install -r requirements.txt
   ```

4. **Configure environment**
   - In the root directory of the project, you will find a file named `.env.example`. Make a copy of this file and rename it to `.env`.
   - Open the `.env` file with a text editor.
   - You will see a line that says `TMDB_API_KEY=your_tmdb_api_key_here`. Replace `your_tmdb_api_key_here` with your actual TMDB API key.
   - Save the file.


## Running the Application

### Starting the Services

You need to run **two services** simultaneously:

**Terminal 1 - Main Server**:
```bash
npm start
# or
node server.js
```

**Terminal 2 - Torrent API** (from project root):
```bash
cd Torrent-Api-py
source api-py/bin/activate  # Linux/macOS
# or
api-py\Scripts\activate     # Windows
python main.py
```

### Accessing the Application

Open your browser and navigate to:
```
http://localhost:8321
```

## Auto-Start on Boot

### Linux (systemd)

1. **Create service files** (see `systemd/` directory):
   - `tmdb-movie-finder.service` - Main server
   - `torrent-api.service` - Torrent API backend

2. **Install services**:
   ```bash
   sudo cp systemd/*.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable tmdb-movie-finder torrent-api
   sudo systemctl start tmdb-movie-finder torrent-api
   ```

3. **Check status**:
   ```bash
   sudo systemctl status tmdb-movie-finder torrent-api
   ```

### Windows (Task Scheduler)

1. **Create batch file** `start-tmdb.bat`:
   ```batch
   @echo off
   start "TMDB Server" cmd /k "cd C:\path\to\tmdb-movie-finder-github && node server.js"
   start "Torrent API" cmd /k "cd C:\path\to\tmdb-movie-finder-github\Torrent-Api-py && api-py\Scripts\activate && python main.py"
   ```

2. **Configure Task Scheduler**:
   - Open Task Scheduler
   - Create Basic Task
   - Trigger: "When I log on"
   - Action: Start a program
   - Program: `C:\path\to\start-tmdb.bat`

### macOS (launchd)

1. **Create plist files** in `~/Library/LaunchAgents/`:

   **`com.tmdb.server.plist`**:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.tmdb.server</string>
       <key>ProgramArguments</key>
       <array>
           <string>/usr/local/bin/node</string>
           <string>/path/to/tmdb-movie-finder-github/server.js</string>
       </array>
       <key>RunAtLoad</key>
       <true/>
       <key>WorkingDirectory</key>
       <string>/path/to/tmdb-movie-finder-github</string>
   </dict>
   </plist>
   ```

   **`com.tmdb.torrentapi.plist`**:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.tmdb.torrentapi</string>
       <key>ProgramArguments</key>
       <array>
           <string>/path/to/tmdb-movie-finder-github/Torrent-Api-py/api-py/bin/python</string>
           <string>/path/to/tmdb-movie-finder-github/Torrent-Api-py/main.py</string>
       </array>
       <key>RunAtLoad</key>
       <true/>
       <key>WorkingDirectory</key>
       <string>/path/to/tmdb-movie-finder-github/Torrent-Api-py</string>
   </dict>
   </plist>
   ```

2. **Load services**:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.tmdb.server.plist
   launchctl load ~/Library/LaunchAgents/com.tmdb.torrentapi.plist
   ```

## Desktop Shortcuts

### Linux (.desktop file)

Create `~/.local/share/applications/tmdb-movie-finder.desktop`:
```desktop
[Desktop Entry]
Name=TMDB Movie Finder
Comment=Open TMDB Movie Finder in browser
Exec=xdg-open http://localhost:8321
Icon=video-x-generic
Terminal=false
Type=Application
Categories=AudioVideo;Video;
```

### Windows (.url file)

Create `TMDB Movie Finder.url` on desktop:
```ini
[InternetShortcut]
URL=http://localhost:8321
IconIndex=0
```

### macOS (.command file)

Create `TMDB Movie Finder.command`:
```bash
#!/bin/bash
open http://localhost:8321
```

Make executable:
```bash
chmod +x "TMDB Movie Finder.command"
```

## qBittorrent WebUI Integration

### Enable qBittorrent WebUI

1. **Open qBittorrent** -> Tools -> Options -> Web UI
2. **Enable** "Web User Interface (Remote control)"
3. **Set credentials**:
   - Username: `admin` (or custom)
   - Password: `adminpass` (change this!)
4. **Note the port** (default: 8080)

### Configure TMDB Movie Finder

Edit `.env` file:
```env
QBITTORRENT_HOST=localhost
QBITTORRENT_PORT=8080
QBITTORRENT_USERNAME=admin
QBITTORRENT_PASSWORD=your_password_here
```

Restart the server for changes to take effect.

### Using Download Integration

1. Search for movies
2. Click "Send to qBittorrent" button on torrent results
3. Torrent automatically added to qBittorrent download queue

## Usage Guide

### Basic Movie Search

1. **By Title**: Enter movie title (e.g., "The Matrix")
2. **By Year**: Add year (e.g., "The Matrix 1999")
3. **By IMDB ID**: Use IMDB ID (e.g., "tt0133093")
4. Click **Search**

### Batch Processing

1. Enter multiple movies (one per line):
   ```
   The Matrix 1999
   Inception 2010
   Interstellar 2014
   ```
2. Select quality preference (1080p, 720p, etc.)
3. Click **Process Movie List**
4. Results saved to `movie_lists/` and `torrent_lists/`

### Refreshing Missing Movies

1. Open **Torrent History** modal
2. Find scan with missing movies
3. Click **Refresh Missing** button
4. System re-scans only movies that didn't find torrents
5. Progress tracked with real-time updates

### Multiple Concurrent Scans

- Run multiple searches simultaneously
- Each scan operates independently
- Progress tracked separately per scan
- Cross-tab synchronization keeps all windows updated

## Troubleshooting

### "TMDB API Error"
- Verify TMDB API key in `.env` file
- Check API key is active at https://www.themoviedb.org/settings/api

### "Torrent API not responding"
- Ensure Torrent-Api-py is running (`python main.py`)
- Check port 8009 is not in use
- Verify Python virtual environment is activated

### "qBittorrent connection failed"
- Verify qBittorrent WebUI is enabled
- Check credentials in `.env` match qBittorrent settings
- Ensure qBittorrent is running

### Port already in use
- Change `PORT=8321` in `.env` to different port
- Change `TORRENT_API_PORT=8009` if needed

### Progress shows "undefined"
- Refresh the page
- Clear browser cache and localStorage
- Ensure both servers are running

## File Structure

```
tmdb-movie-finder-github/
├── server.js                 # Main Express server
├── public/
│   └── index.html           # Frontend application
├── Torrent-Api-py/          # Python torrent search backend
│   ├── main.py
│   ├── requirements.txt
│   └── api-py/              # Virtual environment (created during setup)
├── movie_lists/             # Saved movie search results (created at runtime)
├── torrent_lists/           # Saved torrent results (created at runtime)
├── package.json             # Node.js dependencies
├── .env.example             # Environment template
├── .env                     # Your configuration (create from .env.example)
└── README.md                # This file
```

## API Endpoints

### Movie Search
- `GET /api/movie/search?query=<title>` - Search TMDB by title
- `GET /api/movie/id/:tmdbId` - Get movie by TMDB ID
- `GET /api/movie/imdb/:imdbId` - Get movie by IMDB ID

### Torrent Search
- `GET /api/torrent/search?title=<title>&year=<year>` - Search torrents
- `POST /api/torrent/batch` - Batch process movie list

### Progress Tracking
- `GET /api/refresh-missing/progress/:jobId` - Get job progress
- `POST /api/refresh-missing` - Start refresh job

### qBittorrent Integration
- `POST /api/qbittorrent/add` - Add torrent to qBittorrent

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Credits

- Movie data from [The Movie Database (TMDB)](https://www.themoviedb.org/)
- Torrents from [YTS.lt](https://yts.lt/)
- Torrent search powered by Torrent-Api-py
- Built with Express.js, Node.js, and Python

## Disclaimer


---

                                        ==                                                      
                                      =======                                                   
                                   ===========                                                  
                                     =============         *===                                 
                                 ================       %*+====+                                
                                   =============     %%#+%======                                
                                     ==========+++++  %%*==========                             
                                  =============++++    %%=========                              
                                   ===========+++++#####=========                               
                                     =========++++  ####============                            
                                   ==============++++###==========                              
                                   %============++++***=========                                
                                 +#%%+==========++*****============                             
                                  +**%#========+++=#***+=========                               
                                  ==*+#========+++=##***========                                
                           +== +++===+#%+======++==*****=======                                 
                           ===+++++===========+*====****=====+                                  
                         ====================+++=====##*=++++===                                
                        =========+++=========++========+++++=====                               
                          ====+===+==+====+==++=====+%%*++++======                              
                         =+=======+=+++==+===++======++++++======                               
                           ======+====*==*===++=====+++++++=======                              
                           +=========+*%*+==+++=====++++++======                                
                             ========+*##*==+++=====++++++++++*                                 
                              +==++==+=*#*==+++=====++++++==++++                                
                                =====***#+==+++===++++++++++++                                  
                                  ===+#%*===++++=   +++++++++                                   
                                  ====+%*==+=+==      ++++                                      
                                  ====+ *==+=+==     +===                                       
                                   ====+*==+=+==     ====                                       
                                   ====+*==+=+=     ====                                        
                                   ==+==#==++==    =====                                        
                                   ==+==*==++==    ====                                         
                                    ==*=*===+==   =====                                         
                                    #***#======%%@====                                          
                                    %*%%###############                                         
                                     *=*#===+== ==+==                                           
                                      ==%===*==#==+==                                           
                                      *=%========++=                                            
                                      %+*==+=+==++==                                            
                                      %%%*+++%**####%                                           
                                       +*########*==                                            
                                       =**==+#==++=                                             
                                       =++==+*=====                                             
                                       =====++=====                                             
                                       =====++=====                                             
                                       ============                                             
                                       ======+=====                                             
                                       ======++====                                             
                                        ==+==++====                                             
                                        ==*==++===                                              
                                        == == ++==                                                                                                                                                                                                                                        
                          ____.       .__                   __   
                         |    |_  _  _|  |__   ____   _____/  |_ 
                         |    \ \/ \/ /  |  \_/ __ \_/ __ \   __\
                     /\__|    |\     /|   Y  \  ___/\  ___/|  |  
                     \________| \/\_/ |___|  /\___  >\___  >__|  
                                       \/     \/     \/      

This tool is for educational purposes only. Users are responsible for ensuring their use complies with local laws and regulations. The developers do not condone or encourage piracy.
