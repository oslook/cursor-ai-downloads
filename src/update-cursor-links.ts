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
    platforms: ['win32-x64-user', 'win32-arm64-user', 'win32-x64-system', 'win32-arm64-system', 'win32-x64', 'win32-arm64'],
    readableNames: ['win32-x64-user', 'win32-arm64-user', 'win32-x64-system', 'win32-arm64-system', 'win32-x64', 'win32-arm64'],
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

interface PlatformBadgeConfig {
  color: string;
  logo: string;
  label: string;
}

type PlatformType = 'darwin-universal' | 'darwin-x64' | 'darwin-arm64' |
  'win32-x64-system' | 'win32-arm64-system' | 'win32-x64-user' | 'win32-arm64-user' |
  'linux-x64' | 'linux-arm64' | 'win32-x64' | 'win32-arm64';

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
      // timeout: 10000,
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
 * Generate a unified download badge for a platform
 */
function generateDownloadBadge(platform: PlatformType, url: string): string {
  // Platform configuration
  const platformConfig: Record<PlatformType, PlatformBadgeConfig> = {
    'darwin-universal': { color: '000000', logo: 'apple', label: 'macOS Universal' },
    'darwin-x64': { color: '000000', logo: 'apple', label: 'macOS Intel' },
    'darwin-arm64': { color: '000000', logo: 'apple', label: 'macOS Apple Silicon' },
    'win32-x64-system': { color: '0078D6', logo: 'windows', label: 'Windows x64 System' },
    'win32-arm64-system': { color: '0078D6', logo: 'windows', label: 'Windows ARM64 System' },
    'win32-x64-user': { color: '0078D6', logo: 'windows', label: 'Windows x64 User' },
    'win32-arm64-user': { color: '0078D6', logo: 'windows', label: 'Windows ARM64 User' },
    'win32-x64': { color: '0078D6', logo: 'windows', label: 'Windows x64' },
    'win32-arm64': { color: '0078D6', logo: 'windows', label: 'Windows ARM64' },
    'linux-x64': { color: 'FCC624', logo: 'linux', label: 'Linux x64' },
    'linux-arm64': { color: 'FCC624', logo: 'linux', label: 'Linux ARM64' }
  };

  const config = platformConfig[platform];
  if (!config) {
    return '';
  }

  // Encode the label for URL safety
  const encodedLabel = config.label.replace(/\s+/g, '%20');
  const encodedPlatform = platform.replace(/-/g, '%20');

  return `<a href="${url}"><img src="https://img.shields.io/badge/${encodedLabel}-Download-${config.color}?style=for-the-badge&logo=${config.logo}&logoColor=white" alt="${config.label}"></a>`;
}

/**
 * Generate the latest version card content
 */
function generateLatestVersionCard(version: string, date: string, results: ResultMap): string {
  let cardContent = `<!-- LATEST_VERSION_CARD_START -->
<div align="center">
<div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
<h1 style="text-align: center; margin-bottom: 0;">🚀 Cursor ${version}</h1>
<p style="text-align: center; color: #666; margin-top: 10px; margin-bottom: 20px;">Release Date: ${date}</p>

| Windows | macOS | Linux |
|:---:|:---:|:---:|
| ![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white) | ![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white) | ![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black) |`;

  // Add Windows downloads
  if (results.windows) {
    const x64Url = results.windows['win32-x64']?.url || results.windows['win32-x64-user']?.url;
    const arm64Url = results.windows['win32-arm64']?.url || results.windows['win32-arm64-user']?.url;
    cardContent += `\n| ${generateDownloadBadge('win32-x64-user', x64Url)} | ${generateDownloadBadge('darwin-universal', results.mac?.['darwin-universal']?.url || '')} | ${generateDownloadBadge('linux-x64', results.linux?.['linux-x64']?.url || '')} |`;
    cardContent += `\n| ${generateDownloadBadge('win32-arm64-user', arm64Url)} | ${generateDownloadBadge('darwin-x64', results.mac?.['darwin-x64']?.url || '')} | ${generateDownloadBadge('linux-arm64', results.linux?.['linux-arm64']?.url || '')} |`;
  }

  // Add macOS Apple Silicon download
  if (results.mac?.['darwin-arm64']?.url) {
    if (results.windows?.['win32-arm64-system']?.url) {
      cardContent += `\n| ${generateDownloadBadge('win32-arm64-system', results.windows['win32-arm64-system'].url)} | ${generateDownloadBadge('darwin-arm64', results.mac['darwin-arm64'].url)} |  |`;
    } else {
      cardContent += `\n|  | ${generateDownloadBadge('darwin-arm64', results.mac['darwin-arm64'].url)} |  |`;
    }
  }

  // add windows x64 download
  if (results.windows['win32-x64-system']?.url) {
    cardContent += `\n| ${generateDownloadBadge('win32-x64-system', results.windows['win32-x64-system'].url)} |  |  |`;
  }

  cardContent += `\n\n</div>
</div>
<!-- LATEST_VERSION_CARD_END -->`;

  return cardContent;
}

/**
 * Generate the detailed version card content for a single version
 */
function generateDetailedVersionCard(version: string, date: string, platforms: { [platform: string]: string }): string {
  let cardContent = `\n<details>
<summary><b>Version ${version}</b> (${date})</summary>

<div align="center" style="padding: 20px; margin: 10px 0; border-radius: 5px;">
<h3>Cursor ${version} Download Links</h3>

#### Windows`;

  // Add Windows downloads
  if (platforms['win32-x64-user'] ) {
    cardContent += `\n${generateDownloadBadge('win32-x64-user', platforms['win32-x64-user'] )}`;
  }
  if (platforms['win32-arm64-user'] ) {
    cardContent += `\n${generateDownloadBadge('win32-arm64-user', platforms['win32-arm64-user'] )}`;
  }
  if (platforms['win32-x64-system'] ) {
    cardContent += `\n${generateDownloadBadge('win32-x64-system', platforms['win32-x64-system'] )}`;
  }
  if (platforms['win32-arm64-system'] ) {
    cardContent += `\n${generateDownloadBadge('win32-arm64-system', platforms['win32-arm64-system'] )}`;
  }
  if (platforms['win32-x64'] ) {
    cardContent += `\n${generateDownloadBadge('win32-x64', platforms['win32-x64'] )}`;
  }
  if (platforms['win32-arm64'] ) {
    cardContent += `\n${generateDownloadBadge('win32-arm64', platforms['win32-arm64'] )}`;
  }

  // Add macOS downloads
  cardContent += `\n\n#### macOS`;
  if (platforms['darwin-universal']) {
    cardContent += `\n${generateDownloadBadge('darwin-universal', platforms['darwin-universal'])}`;
  }
  if (platforms['darwin-x64']) {
    cardContent += `\n${generateDownloadBadge('darwin-x64', platforms['darwin-x64'])}`;
  }
  if (platforms['darwin-arm64']) {
    cardContent += `\n${generateDownloadBadge('darwin-arm64', platforms['darwin-arm64'])}`;
  }

  // Add Linux downloads
  cardContent += `\n\n#### Linux`;
  if (platforms['linux-x64']) {
    cardContent += `\n${generateDownloadBadge('linux-x64', platforms['linux-x64'])}`;
  }
  if (platforms['linux-arm64']) {
    cardContent += `\n${generateDownloadBadge('linux-arm64', platforms['linux-arm64'])}`;
  }

  cardContent += `\n\n</div>
</details>`;

  return cardContent;
}

/**
 * Generate detailed cards for all versions
 */
function generateAllDetailedCards(history: VersionHistory): string {
  let allCards = '';

  // Sort versions by version number (newest first)
  const sortedVersions = [...history.versions].sort((a, b) => {
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });

  // Generate cards for each version
  for (const entry of sortedVersions) {
    allCards += generateDetailedVersionCard(entry.version, entry.date, entry.platforms);
  }

  return allCards;
}

/**
 * Generate table row for a single version
 */
function generateTableRow(version: string, date: string, platforms: { [platform: string]: string }): string {
  // Generate Mac links
  let macLinks = '';
  const macPlatforms = ['darwin-universal', 'darwin-x64', 'darwin-arm64'];
  const macLinksList = macPlatforms.map(platform => {
    if (platforms[platform]) {
      return generateDownloadBadge(platform as PlatformType, platforms[platform]);
    }
    return null;
  }).filter(Boolean);
  macLinks = macLinksList.join('<br>');

  // Generate Windows links
  let windowsLinks = '';
  const winPlatforms = ['win32-x64-system', 'win32-arm64-system', 'win32-x64-user', 'win32-arm64-user', 'win32-x64', 'win32-arm64'];
  const winLinksList = winPlatforms.map(platform => {
    if (platforms[platform]) {
      return generateDownloadBadge(platform as PlatformType, platforms[platform]);
    }
    return null;
  }).filter(Boolean);
  windowsLinks = winLinksList.join('<br>');

  // Generate Linux links
  let linuxLinks = '';
  const linuxPlatforms = ['linux-x64', 'linux-arm64'];
  const linuxLinksList = linuxPlatforms.map(platform => {
    if (platforms[platform]) {
      return generateDownloadBadge(platform as PlatformType, platforms[platform]);
    }
    return null;
  }).filter(Boolean);
  linuxLinks = linuxLinksList.join('<br>') || 'Not Ready';

  return `| ${version} | ${date} | ${windowsLinks} | ${macLinks} | ${linuxLinks} |`;
}

/**
 * Generate the complete versions table
 */
function generateVersionsTable(history: VersionHistory): string {
  let tableContent = `<!-- ALL_VERSIONS_TABLE_START -->
| Version | Date | Windows Installer | Mac Installer | Linux Installer |
| --- | --- | --- | --- | --- |`;

  // Sort versions by version number (newest first)
  const sortedVersions = [...history.versions].sort((a, b) => {
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });

  // Generate rows for each version
  for (const entry of sortedVersions) {
    tableContent += `\n${generateTableRow(entry.version, entry.date, entry.platforms)}`;
  }

  tableContent += `\n<!-- ALL_VERSIONS_TABLE_END -->`;
  return tableContent;
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
    console.log(`Version ${latestVersion} already exists in version history, no update needed json`);
    // return false;
  } else {
    console.log(`Adding new version ${latestVersion} to version-history.json`);


    // New version found, update version-history.json first
    console.log(`Adding new version ${latestVersion} to version-history.json`);

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

    // Save the updated history JSON
    try {
      saveVersionHistory(history);
      console.log(`Added version ${latestVersion} to version-history.json`);
    } catch (error) {
      console.error('Error saving version history:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  // Now update the README with the complete history
  const readmePath = path.join(process.cwd(), 'README.md');
  if (!fs.existsSync(readmePath)) {
    console.error('README.md file not found');
    return false;
  }

  let readmeContent = fs.readFileSync(readmePath, 'utf8');

  // Update the versions table with complete history
  const versionsTableRegex = /<!-- ALL_VERSIONS_TABLE_START -->[\s\S]*?<!-- ALL_VERSIONS_TABLE_END -->/;
  const versionsTable = generateVersionsTable(history);
  readmeContent = readmeContent.replace(versionsTableRegex, versionsTable);

  // Update the latest version card with the latest version from history
  const latestVersionCardRegex = /<!-- LATEST_VERSION_CARD_START -->[\s\S]*?<!-- LATEST_VERSION_CARD_END -->/;
  const latestVersionCard = generateLatestVersionCard(history.versions[0].version, history.versions[0].date, results);
  readmeContent = readmeContent.replace(latestVersionCardRegex, latestVersionCard);

  // Update the detailed version cards with all versions from history
  const detailedCardsRegex = /<!-- DETAILED_CARDS_START -->[\s\S]*?<!-- DETAILED_CARDS_END -->/;
  const allDetailedCards = generateAllDetailedCards(history);
  readmeContent = readmeContent.replace(detailedCardsRegex, `<!-- DETAILED_CARDS_START -->${allDetailedCards}<!-- DETAILED_CARDS_END -->`);

  // Save the updated README
  try {
    fs.writeFileSync(readmePath, readmeContent);
    console.log(`README.md updated with complete version history`);
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