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
 * Convert boilerplate paths to repository-specific paths
 * @param {string} filterXmlContent - Original filter.xml content
 * @param {string} repoName - Repository name to use for replacement
 * @returns {string} - Modified filter.xml content
 */
function convertBoilerplatePaths(filterXmlContent, repoName) {
  core.info(`Converting boilerplate paths for repository: ${repoName}`);

  let modifiedContent = filterXmlContent;

  // Handle multiple XML formats
  const patterns = [
    // Self-closing filter tags: <filter root="/path"/>
    /<filter\s+root="([^"]+)"\s*\/>/g,
    // Opening and closing filter tags: <filter root="/path"></filter>
    /<filter\s+root="([^"]+)"><\/filter>/g,
    // Opening and closing filter tags with content: <filter root="/path">...</filter>
    /<filter\s+root="([^"]+)"[^>]*>.*?<\/filter>/g,
  ];

  for (const pattern of patterns) {
    modifiedContent = modifiedContent.replace(pattern, (match, originalPath) => {
      // Convert ALL paths that contain 'sta-xwalk-boilerplate' to use the repo name
      if (originalPath.includes('sta-xwalk-boilerplate')) {
        const newPath = originalPath.replace(/sta-xwalk-boilerplate/g, repoName);
        core.info(`Converting path: ${originalPath} -> ${newPath}`);
        
        // Determine the format to return based on the original match
        if (match.includes('/>')) {
          return `<filter root="${newPath}"/>`;
        } else if (match.includes('></filter>')) {
          return `<filter root="${newPath}"></filter>`;
        } else {
          // For more complex formats, preserve the structure but replace the root attribute
          return match.replace(originalPath, newPath);
        }
      }
      
      return match; // Keep original if not a boilerplate path
    });
  }

  return modifiedContent;
}

/**
 * Rename folders in jcr_root from sta-xwalk-boilerplate to repo name
 * @param {string} jcrRootPath - Path to jcr_root directory
 * @param {string} repoName - Repository name to use for replacement
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
 * Create a new zip file from the modified content
 * @param {string} sourceDir - Directory containing the modified content
 * @param {string} outputPath - Path for the new zip file
 * @returns {Promise<void>}
 */
/**
 * Copy a directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDirectory(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function createZipFromDirectory(sourceDir, outputPath) {
  core.info(`Creating zip file: ${outputPath} from directory: ${sourceDir}`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Sets the compression level
    });

    output.on('close', () => {
      core.info(`Zip file created successfully. Total bytes: ${archive.pointer()}`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Extract the content package to a temporary directory
 * @param {string} contentPackagePath - Path to the content package zip
 * @param {string} extractDir - Directory to extract to
 * @returns {Promise<void>}
 */
async function extractContentPackage(contentPackagePath, extractDir) {
  core.info(`Extracting content package: ${contentPackagePath} to: ${extractDir}`);

  await new Promise((resolve, reject) => {
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
  const tempPackageDir = path.join(zipContentsPath, `temp-converted-${Date.now()}`);
  fs.mkdirSync(tempPackageDir, { recursive: true });
  
  try {
    // Copy jcr_root and META-INF to temp directory
    const tempJcrRoot = path.join(tempPackageDir, 'jcr_root');
    const tempMetaInf = path.join(tempPackageDir, 'META-INF');
    
    // Copy directories recursively
    await copyDirectory(jcrRootPath, tempJcrRoot);
    await copyDirectory(metaInfPath, tempMetaInf);
    
    // Create zip from the temp directory
    await createZipFromDirectory(tempPackageDir, convertedPackagePath);
    
    core.info(`✅ Created converted boilerplate package: ${convertedPackagePath}`);
    
    // Verify the filter.xml in the created package
    const verifyFilterPath = path.join(tempMetaInf, 'vault', 'filter.xml');
    if (fs.existsSync(verifyFilterPath)) {
      const verifyContent = fs.readFileSync(verifyFilterPath, 'utf8');
      core.info(`🔍 Verification - Final filter.xml content:\n${verifyContent}`);
    }
    
    return convertedPackagePath;
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempPackageDir)) {
      fs.rmSync(tempPackageDir, { recursive: true, force: true });
    }
  }
}

/**
 * Work directly with already extracted content package
 * @param {string} zipContentsPath - Path to the already extracted import zip contents
 * @param {string} repoName - Repository name for path replacement
 * @returns {Promise<string>} - Path to the modified content package
 */
async function modifyExtractedContentPackage(zipContentsPath, repoName) {
  core.info(`Working with already extracted content in: ${zipContentsPath}`);

  // Check if this is already extracted boilerplate content (no .zip file, but has jcr_root/META-INF)
  const files = fs.readdirSync(zipContentsPath);
  const contentPackageFile = files.find((file) => file.endsWith('.zip'));
  const hasJcrRoot = fs.existsSync(path.join(zipContentsPath, 'jcr_root'));
  const hasMetaInf = fs.existsSync(path.join(zipContentsPath, 'META-INF'));

  if (!contentPackageFile && hasJcrRoot && hasMetaInf) {
    core.info('🔄 Detected extracted boilerplate content - creating package from directories');
    return await createPackageFromExtractedContent(zipContentsPath, repoName);
  }

  if (!contentPackageFile) {
    throw new Error('No content package (.zip) found in the extracted import zip and no extracted content directories found');
  }

  const contentPackagePath = path.join(zipContentsPath, contentPackageFile);
  core.info(`Found content package: ${contentPackagePath}`);

  // Create temporary directory for extraction and modification
  const tempDir = path.join(zipContentsPath, `temp-package-${Date.now()}`);
  const extractDir = path.join(tempDir, 'extracted');
  const convertedPackagePath = path.join(zipContentsPath, `converted-${contentPackageFile}`);

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    // Extract the content package
    await extractContentPackage(contentPackagePath, extractDir);

    // Read and modify filter.xml
    const filterXmlPath = path.join(extractDir, 'META-INF', 'vault', 'filter.xml');
    if (!fs.existsSync(filterXmlPath)) {
      throw new Error('filter.xml not found in content package');
    }

    const originalFilterContent = fs.readFileSync(filterXmlPath, 'utf8');
    const modifiedFilterContent = convertBoilerplatePaths(originalFilterContent, repoName);

    // Write the modified filter.xml back
    fs.writeFileSync(filterXmlPath, modifiedFilterContent, 'utf8');
    core.info('Updated filter.xml with repository-specific paths');

    // Rename folders in jcr_root
    const jcrRootPath = path.join(extractDir, 'jcr_root');
    if (fs.existsSync(jcrRootPath)) {
      renameFoldersInJcrRoot(jcrRootPath, repoName);
    } else {
      core.warning('jcr_root directory not found in content package');
    }

    // Create new zip with modified content
    await createZipFromDirectory(extractDir, convertedPackagePath);

    return convertedPackagePath;
  } finally {
    // Clean up temporary extraction directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Main function to run the boilerplate converter
 */
export async function run() {
  try {
    // Get inputs
    const zipContentsPath = core.getInput('zip_contents_path');
    const pagePathsInput = core.getInput('page_paths');
    const repoName = core.getInput('repo_name');

    // Validate inputs
    if (!zipContentsPath || !fs.existsSync(zipContentsPath)) {
      throw new Error(`Zip contents path not found: ${zipContentsPath}`);
    }

    if (!repoName) {
      throw new Error('Repository name is required');
    }

    // Parse page paths
    const pagePaths = pagePathsInput ? pagePathsInput.split(',').map((p) => p.trim()) : [];

    core.info(`Checking if package is boilerplate. Found ${pagePaths.length} paths: ${pagePaths.join(', ')}`);

    // Check if this is a boilerplate package
    const isBoilerplate = isBoilerplatePackage(pagePaths);
    core.setOutput('is_boilerplate', isBoilerplate.toString());

    if (!isBoilerplate) {
      core.info('Package is not a boilerplate - no conversion needed');
      return;
    }

    core.info('Package detected as boilerplate - starting conversion');

    // Use the optimized function that works with already extracted content
    const convertedPackagePath = await modifyExtractedContentPackage(zipContentsPath, repoName);

    // Convert the page paths to repository-specific paths
    const convertedPagePaths = pagePaths.map(originalPath => {
      // Convert ALL paths that contain 'sta-xwalk-boilerplate' to use the repo name
      if (originalPath.includes('sta-xwalk-boilerplate')) {
        return originalPath.replace(/sta-xwalk-boilerplate/g, repoName);
      }
      return originalPath; // Keep original if not a boilerplate path
    });

    // Set outputs
    core.setOutput('converted_package_path', convertedPackagePath);
    core.setOutput('converted_page_paths', JSON.stringify(convertedPagePaths));
    core.info(`Boilerplate conversion completed. Converted package: ${convertedPackagePath}`);
    core.info(`Converted page paths: ${convertedPagePaths.join(', ')}`);
    core.info('Assets will be skipped during upload for boilerplate packages');
  } catch (error) {
    core.error(`Boilerplate conversion failed: ${error.message}`);
    core.setOutput('error_message', `Boilerplate conversion failed: ${error.message}`);
  }
}

await run();
