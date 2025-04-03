import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define types for Bun's fetch if needed
declare global {
  interface Response {
    ok: boolean;
    status: number;
    json(): Promise<any>;
  }
}

interface PlatformInfo {
  platforms: string[];
  readableNames: string[];
  section: string;
}

interface PlatformMap {
  [key: string]: PlatformInfo;
}

interface VersionInfo {
  url: string;
  version: string;
}

interface ResultMap {
  [os: string]: {
    [platform: string]: VersionInfo;
  };
}

interface DownloadResponse {
  downloadUrl: string;
}

// Interface for version history JSON
interface VersionHistoryEntry {
  version: string;
  date: string;
  platforms: {
    [platform: string]: string; // platform -> download URL
  };
}

interface VersionHistory {
  versions: VersionHistoryEntry[];
}

const PLATFORMS: PlatformMap = {
  windows: {
    platforms: ['win32-x64-user', 'win32-arm64-user', 'win32-x64-system', 'win32-arm64-system'],
    readableNames: ['win32-x64-user', 'win32-arm64-user', 'win32-x64-system', 'win32-arm64-system'],
    section: 'Windows Installer'
  },
  mac: {
    platforms: ['darwin-universal', 'darwin-x64', 'darwin-arm64'],
    readableNames: ['darwin-universal', 'darwin-x64', 'darwin-arm64'],
    section: 'Mac Installer'
  },
  linux: {
    platforms: ['linux-x64', 'linux-arm64'],
    readableNames: ['linux-x64', 'linux-arm64'],
    section: 'Linux Installer'
  }
};

/**
 * Extract version from URL or filename
 */
function extractVersion(url: string): string {
  // For Windows
  const winMatch = url.match(/Cursor(User|)Setup-[^-]+-([0-9.]+)\.exe/);
  if (winMatch && winMatch[2]) return winMatch[2];
  
  // For other URLs, try to find version pattern
  const versionMatch = url.match(/[0-9]+\.[0-9]+\.[0-9]+/);
  return versionMatch ? versionMatch[0] : 'Unknown';
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fetch latest download URL for a platform
 */
async function fetchLatestDownloadUrl(platform: string): Promise<string | null> {
  try {
    let apiPlatform = platform;
    let isSystemVersion = false;
    
    // Handle system version URLs
    if (platform.endsWith('-system')) {
      apiPlatform = platform.replace('-system', '');
      isSystemVersion = true;
    }
    
    // Simple fetch without complex retry logic
    const response = await fetch(`https://www.cursor.com/api/download?platform=${apiPlatform}&releaseTrack=latest`, {
      headers: {
        'User-Agent': 'Cursor-Version-Checker',
        'Cache-Control': 'no-cache',
      },
      // Keep a reasonable timeout
      timeout: 10000,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json() as DownloadResponse;
    let downloadUrl = data.downloadUrl;
    
    if (isSystemVersion) {
      downloadUrl = downloadUrl.replace('user-setup/CursorUserSetup', 'system-setup/CursorSetup');
    }
    
    return downloadUrl;
  } catch (error) {
    console.error(`Error fetching download URL for platform ${platform}:`, error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Read version history from JSON file
 */
function readVersionHistory(): VersionHistory {
  const historyPath = path.join(process.cwd(), 'version-history.json');
  if (fs.existsSync(historyPath)) {
    try {
      const jsonData = fs.readFileSync(historyPath, 'utf8');
      return JSON.parse(jsonData) as VersionHistory;
    } catch (error) {
      console.error('Error reading version history:', error instanceof Error ? error.message : 'Unknown error');
      return { versions: [] };
    }
  } else {
    console.log('version-history.json not found, creating a new file');
    return { versions: [] };
  }
}

/**
 * Save version history to JSON file
 */
function saveVersionHistory(history: VersionHistory): void {
  if (!history || !Array.isArray(history.versions)) {
    console.error('Invalid version history object provided');
    return;
  }

  const historyPath = path.join(process.cwd(), 'version-history.json');
  
  // Keep backup - useful even for GitHub Actions
  if (fs.existsSync(historyPath)) {
    try {
      const backupPath = `${historyPath}.backup`;
      fs.copyFileSync(historyPath, backupPath);
      console.log(`Created backup at ${backupPath}`);
    } catch (error) {
      console.error('Failed to create backup of version history:', error instanceof Error ? error.message : 'Unknown error');
      // Continue anyway, as creating backup is not critical
    }
  }
  
  try {
    const jsonData = JSON.stringify(history, null, 2);

    // Verify we have valid JSON before writing to file
    try {
      JSON.parse(jsonData);
    } catch (parseError) {
      console.error('Generated invalid JSON data, aborting save:', parseError instanceof Error ? parseError.message : 'Unknown error');
      return;
    }

    // Write to a temporary file first, then rename to avoid partial writes
    const tempPath = `${historyPath}.tmp`;
    fs.writeFileSync(tempPath, jsonData, 'utf8');
    fs.renameSync(tempPath, historyPath);

    // Verify file exists after writing
    if (fs.existsSync(historyPath)) {
      console.log('Version history saved to version-history.json');
    } else {
      console.error('Failed to save version history: File does not exist after write');
    }
  } catch (error) {
    console.error('Error saving version history:', error instanceof Error ? error.message : 'Unknown error');
    throw error; // Rethrow to allow caller to handle
  }
}

/**
 * Update the README.md file with latest Cursor links
 */
async function updateReadme(): Promise<boolean> {
  console.log(`Starting update check at ${new Date().toISOString()}`);
  
  // Collect all URLs and versions
  const results: ResultMap = {};
  let latestVersion = '0.0.0';
  const currentDate = formatDate(new Date());
  
  // Fetch all platform download URLs
  for (const [osKey, osData] of Object.entries(PLATFORMS)) {
    results[osKey] = {};
    
    for (let i = 0; i < osData.platforms.length; i++) {
      const platform = osData.platforms[i];
      const url = await fetchLatestDownloadUrl(platform);
      
      if (url) {
        const version = extractVersion(url);
        results[osKey][platform] = { url, version };
        
        // Track the highest version number
        if (version !== 'Unknown' && version > latestVersion) {
          latestVersion = version;
        }
      }
    }
  }
  
  if (latestVersion === '0.0.0') {
    console.error('Failed to retrieve any valid version information');
    return false;
  }
  
  console.log(`Latest version detected: ${latestVersion}`);
  
  // Use version-history.json as the single source of truth for version checking
  const history = readVersionHistory();
  
  // Check if this version already exists in the version history
  const existingVersionIndex = history.versions.findIndex(entry => entry.version === latestVersion);
  if (existingVersionIndex !== -1) {
    console.log(`Version ${latestVersion} already exists in version history, no update needed`);
    return false;
  }
  
  // New version found, update both version-history.json and README.md
  console.log(`Adding new version ${latestVersion} to both version-history.json and README.md`);
  
  // Read README
  const readmePath = path.join(process.cwd(), 'README.md');
  if (!fs.existsSync(readmePath)) {
    console.error('README.md file not found');
    return false;
  }
  
  let readmeContent = fs.readFileSync(readmePath, 'utf8');
  
  // Create a new platforms object for the history entry
  const platforms: { [platform: string]: string } = {};
  
  // Add Mac platforms
  if (results.mac) {
    for (const [platform, info] of Object.entries(results.mac)) {
      platforms[platform] = info.url;
    }
  }
  
  // Add Windows platforms
  if (results.windows) {
    for (const [platform, info] of Object.entries(results.windows)) {
      platforms[platform] = info.url;
    }
  }
  
  // Add Linux platforms
  if (results.linux) {
    for (const [platform, info] of Object.entries(results.linux)) {
      platforms[platform] = info.url;
    }
  }
  
  // Create the new entry
  const newEntry: VersionHistoryEntry = {
    version: latestVersion,
    date: currentDate,
    platforms
  };
  
  // Add to history and sort by version (newest first)
  history.versions.push(newEntry);
  history.versions.sort((a, b) => {
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });
  
  // Limit history size to 100 entries to prevent unlimited growth
  if (history.versions.length > 100) {
    history.versions = history.versions.slice(0, 100);
    console.log(`Truncated version history to 100 entries`);
  }
  
  // IMPORTANT: Save the updated history JSON BEFORE updating the README
  // This ensures the version-history.json is updated even if README update fails
  try {
    saveVersionHistory(history);
    console.log(`Added version ${latestVersion} to version-history.json`);
  } catch (error) {
    console.error('Error saving version history:', error instanceof Error ? error.message : 'Unknown error');
    // Continue with README update even if version history save fails
  }
  
  // Update the date in the Cursor AI IDE section
  const ideUpdateRegex = /(Official Download Link for The latest version from `\[Cursor AI IDE\]'s \[Check for Updates\.\.\.\]` \(on `)([^`]+)(`\) is:)/;
  readmeContent = readmeContent.replace(ideUpdateRegex, `$1${currentDate}$3`);
  
  // Also update the date in the website section
  const websiteUpdateRegex = /(Official Download Link for The latest version from \[Cursor AI's Website\]\(https:\/\/www\.cursor\.com\/downloads\) \(on `)([^`]+)(`\) is:)/;
  readmeContent = readmeContent.replace(websiteUpdateRegex, `$1${currentDate}$3`);
  
  // Add new row to the table for the latest version
  const tableStartRegex = /\| Version \| Date \| Mac Installer \| Windows Installer \| Linux Installer \|\n\| --- \| --- \| --- \| --- \| --- \|/;
  
  // Generate Mac links section
  let macLinks = '';
  if (results.mac) {
    const macUrls = PLATFORMS.mac.platforms.map(platform => {
      if (results.mac[platform] && results.mac[platform].url) {
        return `[${platform}](${results.mac[platform].url})`;
      }
      return null;
    }).filter(Boolean);
    
    macLinks = macUrls.join(' <br>');
  }
  
  // Generate Windows links section
  let windowsLinks = '';
  if (results.windows) {
    const winUrls = PLATFORMS.windows.platforms.map(platform => {
      if (results.windows[platform] && results.windows[platform].url) {
        return `[${platform}](${results.windows[platform].url})`;
      }
      return null;
    }).filter(Boolean);
    
    windowsLinks = winUrls.join('<br>');
  }
  
  // Generate Linux link
  let linuxLinks = 'Not Ready';
  if (results.linux) {
    const linuxUrls = PLATFORMS.linux.platforms.map(platform => {
      if (results.linux[platform] && results.linux[platform].url) {
        return `[${platform}](${results.linux[platform].url})`;
      }
      return null;
    }).filter(Boolean);
    
    if (linuxUrls.length > 0) {
      linuxLinks = linuxUrls.join('<br>');
    }
  }
  
  // New table row
  const newRow = `\n| ${latestVersion} | ${currentDate} | ${macLinks} | ${windowsLinks} | ${linuxLinks} |`;
  
  // Insert the new row after the table header
  readmeContent = readmeContent.replace(tableStartRegex, `$&${newRow}`);
  
  // Save the updated README
  try {
    fs.writeFileSync(readmePath, readmeContent);
    console.log(`README.md updated with Cursor version ${latestVersion}`);
  } catch (error) {
    console.error('Error saving README:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
  
  return true;
}

/**
 * Update version history JSON with new version information - deprecated, now handled in updateReadme
 */
function updateVersionHistory(version: string, date: string, results: ResultMap): void {
  console.warn('updateVersionHistory is deprecated - version history is now updated directly in updateReadme');
  
  // For backward compatibility, create and save a version history entry
  if (!version || !date || !results) {
    console.error('Invalid parameters provided to updateVersionHistory');
    return;
  }
  
  try {
    // Read existing history
    const history = readVersionHistory();
    
    // Check if this version already exists
    if (history.versions.some(v => v.version === version)) {
      console.log(`Version ${version} already exists in version history`);
      return;
    }
    
    // Prepare platforms data from results
    const platforms: { [platform: string]: string } = {};
    
    // Extract platforms and URLs from results
    Object.entries(results).forEach(([osKey, osData]) => {
      Object.entries(osData).forEach(([platform, info]) => {
        platforms[platform] = info.url;
      });
    });
    
    // Create new entry
    const newEntry: VersionHistoryEntry = {
      version,
      date,
      platforms
    };
    
    // Add to history and sort
    history.versions.push(newEntry);
    history.versions.sort((a, b) => {
      return b.version.localeCompare(a.version, undefined, { numeric: true });
    });
    
    // Save updated history
    saveVersionHistory(history);
    console.log(`Added version ${version} to version-history.json via deprecated method`);
  } catch (error) {
    console.error('Error in updateVersionHistory:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Main function to run the update with proper error handling
 */
async function main(): Promise<void> {
  try {
    const startTime = Date.now();
    console.log(`Starting update process at ${new Date().toISOString()}`);
    
    // Run the update
    const updated = await updateReadme();
    const elapsedTime = Date.now() - startTime;
    
    if (updated) {
      console.log(`Update completed successfully in ${elapsedTime}ms. Found new version.`);
    } else {
      console.log(`Update completed in ${elapsedTime}ms. No new version found.`);
    }

    // Double-check version history JSON file exists at the end
    const historyPath = path.join(process.cwd(), 'version-history.json');
    if (!fs.existsSync(historyPath)) {
      console.warn('Warning: version-history.json does not exist after update. This might indicate an issue.');
    } else {
      try {
        // Just checking that the file is valid JSON
        const content = fs.readFileSync(historyPath, 'utf8');
        const historyJson = JSON.parse(content) as VersionHistory;
        console.log('Verified version-history.json exists and contains valid JSON.');
        
        // Verify that the latest version from README is in version-history.json
        const readmePath = path.join(process.cwd(), 'README.md');
        if (fs.existsSync(readmePath)) {
          const readmeContent = fs.readFileSync(readmePath, 'utf8');
          
          // Extract the latest version from table - look for the first row after header
          const versionMatch = readmeContent.match(/\| (\d+\.\d+\.\d+) \| (\d{4}-\d{2}-\d{2}) \|/);
          if (versionMatch && versionMatch[1]) {
            const latestVersionInReadme = versionMatch[1];
            const latestDateInReadme = versionMatch[2];
            
            console.log(`Latest version in README.md: ${latestVersionInReadme} (${latestDateInReadme})`);
            
            // Check if this version exists in history
            const versionExists = historyJson.versions.some(v => v.version === latestVersionInReadme);
            if (!versionExists) {
              console.warn(`WARNING: Version ${latestVersionInReadme} is in README.md but not in version-history.json.`);
              console.log(`Attempting to extract data from README.md and update version-history.json...`);
              
              // Extract URLs for this version from README
              const sectionRegex = new RegExp(`\\| ${latestVersionInReadme} \\| ${latestDateInReadme} \\| (.*?) \\| (.*?) \\| (.*?) \\|`);
              const sectionMatch = readmeContent.match(sectionRegex);
              
              if (sectionMatch) {
                const macSection = sectionMatch[1];
                const windowsSection = sectionMatch[2];
                const linuxSection = sectionMatch[3];
                
                const platforms: { [platform: string]: string } = {};
                
                // Parse Mac links
                if (macSection) {
                  const macLinks = macSection.match(/\[([^\]]+)\]\(([^)]+)\)/g);
                  if (macLinks) {
                    macLinks.forEach(link => {
                      const parts = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
                      if (parts && parts[1] && parts[2]) {
                        platforms[parts[1]] = parts[2];
                      }
                    });
                  }
                }
                
                // Parse Windows links
                if (windowsSection) {
                  const winLinks = windowsSection.match(/\[([^\]]+)\]\(([^)]+)\)/g);
                  if (winLinks) {
                    winLinks.forEach(link => {
                      const parts = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
                      if (parts && parts[1] && parts[2]) {
                        platforms[parts[1]] = parts[2];
                      }
                    });
                  }
                }
                
                // Parse Linux links
                if (linuxSection && linuxSection !== 'Not Ready') {
                  const linuxLinks = linuxSection.match(/\[([^\]]+)\]\(([^)]+)\)/g);
                  if (linuxLinks) {
                    linuxLinks.forEach(link => {
                      const parts = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
                      if (parts && parts[1] && parts[2]) {
                        platforms[parts[1]] = parts[2];
                      }
                    });
                  }
                }
                
                // Add the entry to version history
                if (Object.keys(platforms).length > 0) {
                  const newEntry: VersionHistoryEntry = {
                    version: latestVersionInReadme,
                    date: latestDateInReadme,
                    platforms
                  };
                  
                  historyJson.versions.push(newEntry);
                  
                  // Sort and save
                  historyJson.versions.sort((a, b) => {
                    return b.version.localeCompare(a.version, undefined, { numeric: true });
                  });
                  
                  // Save the updated history
                  saveVersionHistory(historyJson);
                  console.log(`Successfully added version ${latestVersionInReadme} from README.md to version-history.json`);
                } else {
                  console.error(`Failed to extract platform links for version ${latestVersionInReadme}`);
                }
              } else {
                console.error(`Failed to find section for version ${latestVersionInReadme} in README.md`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Warning: version-history.json exists but contains invalid JSON:', 
          err instanceof Error ? err.message : 'Unknown error');
      }
    }
  } catch (error) {
    console.error('Critical error during update process:', error instanceof Error ? error.message : 'Unknown error');
    // Any GitHub Action will mark the workflow as failed if the process exits with non-zero
    process.exit(1);
  }
}

// Export functions for testing
export { 
  fetchLatestDownloadUrl, 
  updateReadme, 
  readVersionHistory, 
  saveVersionHistory, 
  updateVersionHistory,
  extractVersion,
  formatDate,
  main
};

// Run the update
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  });
} 