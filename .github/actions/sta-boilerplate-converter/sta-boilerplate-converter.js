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
  if (paths.length !== 3) {
    return false;
  }

  // Sort both arrays to ensure order doesn't matter
  const sortedPaths = [...paths].sort();
  const sortedBoilerplate = [...BOILERPLATE_PATHS].sort();

  return sortedPaths.every((pathItem, index) => pathItem === sortedBoilerplate[index]);
}

/**
 * Convert boilerplate paths to repository-specific paths
 * @param {string} filterXmlContent - Original filter.xml content
 * @param {string} repoName - Repository name to use for replacement
 * @returns {string} - Modified filter.xml content
 */
function convertBoilerplatePaths(filterXmlContent, repoName) {
  core.info(`Converting boilerplate paths for repository: ${repoName}`);

  return filterXmlContent.replace(
    /<filter\s+root="([^"]+)"><\/filter>/g,
    (match, originalPath) => {
      if (originalPath === '/content/sta-xwalk-boilerplate/tools') {
        const newPath = `/content/${repoName}/tools`;
        core.info(`Converting path: ${originalPath} -> ${newPath}`);
        return `<filter root="${newPath}"></filter>`;
      }
      if (originalPath === '/content/sta-xwalk-boilerplate/block-collection') {
        const newPath = `/content/${repoName}/block-collection`;
        core.info(`Converting path: ${originalPath} -> ${newPath}`);
        return `<filter root="${newPath}"></filter>`;
      }
      if (originalPath === '/content/dam/sta-xwalk-boilerplate/block-collection') {
        const newPath = `/content/dam/${repoName}/block-collection`;
        core.info(`Converting path: ${originalPath} -> ${newPath}`);
        return `<filter root="${newPath}"></filter>`;
      }
      return match; // Keep original if not a boilerplate path
    },
  );
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
 * Work directly with already extracted content package
 * @param {string} zipContentsPath - Path to the already extracted import zip contents
 * @param {string} repoName - Repository name for path replacement
 * @returns {Promise<string>} - Path to the modified content package
 */
async function modifyExtractedContentPackage(zipContentsPath, repoName) {
  core.info(`Working with already extracted content in: ${zipContentsPath}`);

  // Find the content package (.zip file) in the extracted contents
  const files = fs.readdirSync(zipContentsPath);
  const contentPackageFile = files.find((file) => file.endsWith('.zip'));

  if (!contentPackageFile) {
    throw new Error('No content package (.zip) found in the extracted import zip');
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

    // Set outputs
    core.setOutput('converted_package_path', convertedPackagePath);
    core.info(`Boilerplate conversion completed. Converted package: ${convertedPackagePath}`);
    core.info('Assets will be skipped during upload for boilerplate packages');
  } catch (error) {
    core.error(`Boilerplate conversion failed: ${error.message}`);
    core.setOutput('error_message', `Boilerplate conversion failed: ${error.message}`);
  }
}

await run();
