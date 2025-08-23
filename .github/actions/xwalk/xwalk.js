/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import core from '@actions/core';
import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import archiver from 'archiver';

/**
 * Expected boilerplate paths that indicate this is a boilerplate package
 */
const BOILERPLATE_PATHS = [
  '/content/sta-xwalk-boilerplate/tools',
  '/content/sta-xwalk-boilerplate/block-collection',
  '/content/dam/sta-xwalk-boilerplate/block-collection',
];

/**
 * Get the list of paths from a filter.xml file.
 * @param {string} xmlString
 * @returns {string[]}
 */
function getFilterPaths(xmlString) {
  const paths = [];

  // Try multiple regex patterns to handle different XML formats
  const patterns = [
    // Self-closing filter tags: <filter root="/path"/>
    /<filter\s+root="([^"]+)"\s*\/>/g,
    // Opening and closing filter tags: <filter root="/path"></filter>
    /<filter\s+root="([^"]+)"><\/filter>/g,
    // Opening and closing filter tags with content: <filter root="/path">...</filter>
    /<filter\s+root="([^"]+)"[^>]*>.*?<\/filter>/g,
    // Filter tags with other attributes
    /<filter[^>]+root="([^"]+)"[^>]*>/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(xmlString)) !== null) {
      const path = match[1];
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }

  return paths;
}

/**
 * Check if the given paths match the boilerplate pattern
 * @param {string[]} paths - Array of paths from filter.xml
 * @returns {boolean} - True if this is a boilerplate package
 */
function isBoilerplatePackage(paths) {
  if (!paths || paths.length === 0) {
    return false;
  }

  // Check if all required boilerplate paths are present
  const requiredPathsFound = BOILERPLATE_PATHS.every(requiredPath => 
    paths.some(path => path === requiredPath)
  );

  // Also check if most paths are boilerplate-related (allows for additional paths)
  const boilerplateRelatedPaths = paths.filter(path => 
    path.includes('sta-xwalk-boilerplate')
  );

  // Consider it boilerplate if:
  // 1. All required boilerplate paths are found, OR
  // 2. At least 2 boilerplate-related paths are found and they make up most of the paths
  return requiredPathsFound || 
         (boilerplateRelatedPaths.length >= 2 && boilerplateRelatedPaths.length >= paths.length * 0.6);
}

/**
 * Gets the path to the content package zip file from the specified directory.
 * @param zipContentsPath
 * @returns {string|null} - Returns null if no zip file found (for boilerplate content)
 */
function getContentPackagePath(zipContentsPath) {
  // Find the first .zip file in the directory
  const files = fs.readdirSync(zipContentsPath);
  const firstZipFile = files.find((file) => file.endsWith('.zip'));
  if (!firstZipFile) {
    return null; // No zip file found - might be boilerplate content
  }

  // Return the first .zip file found - presumably the content package
  return path.join(zipContentsPath, firstZipFile);
}

/**
 * Extract filter.xml and check if this is a boilerplate package
 * @param {string} zipContentsPath - Path to the extracted import zip contents
 * @returns {Promise<{isBoilerplate: boolean, contentPackagePath: string, pagePaths: string[]}>}
 */
async function detectBoilerplate(zipContentsPath) {
  const contentPackagePath = getContentPackagePath(zipContentsPath);
  
  // Check if this is boilerplate content (no zip file, but META-INF directory exists)
  const metaInfPath = path.join(zipContentsPath, 'META-INF', 'vault', 'filter.xml');
  const isBoilerplateContent = !contentPackagePath && fs.existsSync(metaInfPath);
  
  let extractedPaths = [];

  if (isBoilerplateContent) {
    core.info('✅ Detected boilerplate content - reading filter.xml directly');
    
    try {
      const filterContent = fs.readFileSync(metaInfPath, 'utf8');
      core.debug(`Filter XML content: ${filterContent}`);
      extractedPaths = getFilterPaths(filterContent);
      core.info(`✅ Extracted ${extractedPaths.length} page paths from boilerplate content: ${extractedPaths.join(', ')}`);
    } catch (error) {
      throw new Error(`Error reading filter.xml from boilerplate content: ${error.message}`);
    }
  } else {
    if (!contentPackagePath) {
      throw new Error('No .zip files found in the specified directory and no boilerplate content detected.');
    }
    
    core.info(`✅ Content Package Path: ${contentPackagePath}`);

    try {
      await new Promise((resolve, reject) => {
        fs.createReadStream(contentPackagePath)
          .pipe(unzipper.ParseOne('META-INF/vault/filter.xml'))
          .pipe(fs.createWriteStream('filter.xml'))
          .on('finish', () => {
            core.info('filter.xml extracted successfully');
            fs.readFile('filter.xml', 'utf8', (err, data) => {
              if (err) {
                reject(new Error(`Error reading extracted file: ${err}`));
              } else {
                core.debug(`Filter XML content: ${data}`);
                const paths = getFilterPaths(data);
                extractedPaths = paths;
                resolve();
              }
            });
          })
          .on('error', (error) => {
            reject(new Error(`Error extracting filter.xml: ${error}`));
          });
      });
    } finally {
      // Clean up the filter xml file after extraction
      try {
        if (fs.existsSync('filter.xml')) {
          fs.unlinkSync('filter.xml');
        }
      } catch (cleanupError) {
        core.warning(`Failed to remove filter.xml: ${cleanupError.message}`);
      }
    }
  }

  const isBoilerplate = isBoilerplatePackage(extractedPaths);

  return {
    isBoilerplate,
    contentPackagePath: contentPackagePath || '', // Return empty string for boilerplate content
    pagePaths: extractedPaths,
  };
}

/**
 * Convert boilerplate paths to repository-specific paths
 * @param {string} filterXmlContent - Original filter.xml content
 * @param {string} repoName - Repository name to use for replacement
 * @returns {string} - Modified filter.xml content
 */
function convertBoilerplatePaths(filterXmlContent, repoName) {
  core.info(`Converting boilerplate paths for repository: ${repoName}`);
  
  // Use regex to find and replace paths, preserving XML structure
  let modifiedContent = filterXmlContent;
  
  // Replace the paths in root attributes and any text content
  modifiedContent = modifiedContent.replace(/sta-xwalk-boilerplate/g, repoName);
  
  // Also handle the case where paths might be in different formats or escaped
  // This regex looks for paths that contain 'sta-xwalk-boilerplate' and replaces them
  modifiedContent = modifiedContent.replace(
    /root="([^"]*sta-xwalk-boilerplate[^"]*)"/g,
    (match, originalPath) => {
      // Convert ALL paths that contain 'sta-xwalk-boilerplate' to use the repo name
              if (originalPath.includes('sta-xwalk-boilerplate')) {
          const newPath = originalPath.replace(/sta-xwalk-boilerplate/g, repoName);
          core.info(`  Converted path: ${originalPath} -> ${newPath}`);
          return `root="${newPath}"`;
        }
        return match; // Keep original if something went wrong
      }
    );

  // Additional pattern to catch any remaining instances that might be formatted differently
  modifiedContent = modifiedContent.replace(
    /([^"\w-])sta-xwalk-boilerplate([^"\w-])/g,
    `$1${repoName}$2`
  );

  return modifiedContent;
}

/**
 * Rename folders in jcr_root from sta-xwalk-boilerplate to repo name
 * @param {string} jcrRootPath - Path to jcr_root directory
 * @param {string} repoName - Repository name to use
 */
function renameFoldersInJcrRoot(jcrRootPath, repoName) {
  core.info(`Renaming folders in jcr_root from sta-xwalk-boilerplate to ${repoName}`);

  // Check if content/sta-xwalk-boilerplate exists
  const contentDir = path.join(jcrRootPath, 'content');
  const boilerplateContentDir = path.join(contentDir, 'sta-xwalk-boilerplate');
  const newContentDir = path.join(contentDir, repoName);

  if (fs.existsSync(boilerplateContentDir)) {
    core.info(`Renaming: ${boilerplateContentDir} -> ${newContentDir}`);
    fs.renameSync(boilerplateContentDir, newContentDir);
  }

  // Check if content/dam/sta-xwalk-boilerplate exists
  const damDir = path.join(jcrRootPath, 'content', 'dam');
  const boilerplateDamDir = path.join(damDir, 'sta-xwalk-boilerplate');
  const newDamDir = path.join(damDir, repoName);

  if (fs.existsSync(boilerplateDamDir)) {
    core.info(`Renaming: ${boilerplateDamDir} -> ${newDamDir}`);
    fs.renameSync(boilerplateDamDir, newDamDir);
  }
}

/**
 * Create zip file from directory contents
 * @param {string} sourceDir - Directory to zip
 * @param {string} outputPath - Path for the output zip file
 * @returns {Promise<void>}
 */
async function createZipFromDirectory(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', () => {
      core.info(`✅ Created zip file: ${outputPath} (${archive.pointer()} total bytes)`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    
    // Add all contents of the source directory to the zip
    archive.directory(sourceDir, false);
    
    archive.finalize();
  });
}

/**
 * Extract content package to a directory
 * @param {string} contentPackagePath - Path to the content package zip
 * @param {string} extractDir - Directory to extract to
 * @returns {Promise<void>}
 */
async function extractContentPackage(contentPackagePath, extractDir) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(contentPackagePath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

/**
 * Create a content package from already extracted boilerplate content
 * @param {string} zipContentsPath - Path to the already extracted import zip contents
 * @param {string} repoName - Repository name for path replacement
 * @returns {Promise<string>} - Path to the created content package
 */
async function createPackageFromExtractedContent(zipContentsPath, repoName) {
  core.info(`Creating package from extracted boilerplate content in: ${zipContentsPath}`);

  // Check if this is already extracted content (has jcr_root and META-INF directories)
  const jcrRootPath = path.join(zipContentsPath, 'jcr_root');
  const metaInfPath = path.join(zipContentsPath, 'META-INF');
  
  if (!fs.existsSync(jcrRootPath) || !fs.existsSync(metaInfPath)) {
    throw new Error('Expected jcr_root and META-INF directories not found in extracted content');
  }

  core.info('✅ Found jcr_root and META-INF directories - processing extracted boilerplate content');

  // Read and modify filter.xml
  const filterXmlPath = path.join(metaInfPath, 'vault', 'filter.xml');
  if (!fs.existsSync(filterXmlPath)) {
    throw new Error('filter.xml not found in META-INF/vault directory');
  }

  const originalFilterContent = fs.readFileSync(filterXmlPath, 'utf8');
  core.info(`📄 Original filter.xml content:\n${originalFilterContent}`);
  
  const modifiedFilterContent = convertBoilerplatePaths(originalFilterContent, repoName);
  core.info(`📄 Modified filter.xml content:\n${modifiedFilterContent}`);

  // Write the modified filter.xml back
  fs.writeFileSync(filterXmlPath, modifiedFilterContent, 'utf8');
  core.info('✅ Updated filter.xml with repository-specific paths');

  // Rename folders in jcr_root
  renameFoldersInJcrRoot(jcrRootPath, repoName);

  // Create new zip with modified content - only include jcr_root and META-INF
  const convertedPackagePath = path.join(zipContentsPath, `converted-boilerplate-${repoName}.zip`);
  
  // Create a temporary directory with only the content we want to zip
  const tempPackageDir = path.join(zipContentsPath, 'temp_package');
  if (fs.existsSync(tempPackageDir)) {
    fs.rmSync(tempPackageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempPackageDir, { recursive: true });

  // Copy jcr_root and META-INF to temp directory
  const tempJcrRoot = path.join(tempPackageDir, 'jcr_root');
  const tempMetaInf = path.join(tempPackageDir, 'META-INF');
  
  fs.cpSync(jcrRootPath, tempJcrRoot, { recursive: true });
  fs.cpSync(metaInfPath, tempMetaInf, { recursive: true });

  // Create zip from temp directory
  await createZipFromDirectory(tempPackageDir, convertedPackagePath);

  // Clean up temp directory
  fs.rmSync(tempPackageDir, { recursive: true, force: true });

  if (fs.existsSync(convertedPackagePath)) {
    core.info(`✅ Created converted boilerplate package: ${convertedPackagePath}`);
    return convertedPackagePath;
  } else {
    throw new Error('Failed to create converted package');
  }
}

/**
 * Modify extracted content package (handles both zipped content packages and already extracted boilerplate content)
 * @param {string} zipContentsPath - Path to the extracted import zip contents
 * @param {string} repoName - Repository name for path replacement
 * @returns {Promise<string>} - Path to the converted content package
 */
async function modifyExtractedContentPackage(zipContentsPath, repoName) {
  core.info(`Processing content package in: ${zipContentsPath}`);

  // Check if this is already extracted boilerplate content (no .zip file, but has jcr_root/META-INF)
  const jcrRootPath = path.join(zipContentsPath, 'jcr_root');
  const metaInfPath = path.join(zipContentsPath, 'META-INF');
  const hasDirectories = fs.existsSync(jcrRootPath) && fs.existsSync(metaInfPath);
  const contentPackagePath = getContentPackagePath(zipContentsPath);

  if (!contentPackagePath && hasDirectories) {
    core.info('🔄 Detected extracted boilerplate content - creating package from directories');
    return await createPackageFromExtractedContent(zipContentsPath, repoName);
  } else if (contentPackagePath) {
    core.info(`🔄 Found content package: ${contentPackagePath} - extracting and modifying`);
    
    // Extract the content package
    const extractedDir = path.join(zipContentsPath, 'extracted_package');
    if (fs.existsSync(extractedDir)) {
      fs.rmSync(extractedDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractedDir, { recursive: true });

    await extractContentPackage(contentPackagePath, extractedDir);
    core.info('✅ Content package extracted successfully');

    // Now process the extracted content
    return await createPackageFromExtractedContent(extractedDir, repoName);
  } else {
    throw new Error('No content package found and no extracted boilerplate content detected');
  }
}

/**
 * Main function to run the xwalk action (detection and optional conversion)
 */
export async function run() {
  try {
    // Get inputs
    const zipContentsPath = core.getInput('zip_contents_path');
    const pagePathsInput = core.getInput('page_paths');
    const repoName = core.getInput('repo_name');
    const convertMode = core.getInput('convert') === 'true';

    // Validate inputs
    if (!zipContentsPath || !fs.existsSync(zipContentsPath)) {
      throw new Error(`Zip contents path not found: ${zipContentsPath}`);
    }

    core.info(`Checking if package is boilerplate: ${zipContentsPath}`);

    // First, detect if this is a boilerplate package
    const result = await detectBoilerplate(zipContentsPath);

    // Set outputs for detection
    core.setOutput('is_boilerplate', result.isBoilerplate.toString());
    core.setOutput('content_package_path', result.contentPackagePath);
    core.setOutput('page_paths', result.pagePaths.join(','));

    if (result.isBoilerplate) {
      core.info(`✅ Detected boilerplate package with ${result.pagePaths.length} paths: ${result.pagePaths.join(', ')}`);
      
      // If conversion is requested and we have a repo name
      if (convertMode && repoName) {
        core.info('Package detected as boilerplate - starting conversion');

        // Use the optimized function that works with already extracted content
        const convertedPackagePath = await modifyExtractedContentPackage(zipContentsPath, repoName);

        // Convert the page paths to repository-specific paths
        const convertedPagePaths = result.pagePaths.map(originalPath => {
          // Convert ALL paths that contain 'sta-xwalk-boilerplate' to use the repo name
          if (originalPath.includes('sta-xwalk-boilerplate')) {
            return originalPath.replace(/sta-xwalk-boilerplate/g, repoName);
          }
          return originalPath; // Keep original if not a boilerplate path
        });

        // Set conversion outputs
        core.setOutput('converted_package_path', convertedPackagePath);
        core.setOutput('converted_page_paths', JSON.stringify(convertedPagePaths));
        core.info(`Boilerplate conversion completed. Converted package: ${convertedPackagePath}`);
        core.info(`Converted page paths: ${convertedPagePaths.join(', ')}`);
        core.info('Assets will be skipped during upload for boilerplate packages');
      } else if (convertMode) {
        throw new Error('Repository name is required for conversion');
      }
    } else {
      core.info(`✅ Not a boilerplate package. Found ${result.pagePaths.length} paths: ${result.pagePaths.join(', ')}`);
      if (convertMode) {
        core.info('Package is not a boilerplate - no conversion needed');
      }
    }
  } catch (error) {
    core.error(`Xwalk operation failed: ${error.message}`);
    core.setOutput('error_message', `Xwalk operation failed: ${error.message}`);
  }
}

await run();
