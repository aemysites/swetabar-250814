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
  const lines = xmlString.split('\n');
  const paths = [];

  for (const line of lines) {
    const match = line.match(/^\s*<filter\s+root="([^"]+)"><\/filter>\s*$/);
    if (match) {
      paths.push(match[1]);
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
  if (paths.length !== 3) {
    return false;
  }

  // Sort both arrays to ensure order doesn't matter
  const sortedPaths = [...paths].sort();
  const sortedBoilerplate = [...BOILERPLATE_PATHS].sort();

  return sortedPaths.every((pathItem, index) => pathItem === sortedBoilerplate[index]);
}

/**
 * Gets the path to the content package zip file from the specified directory.
 * @param zipContentsPath
 * @returns {string}
 */
function getContentPackagePath(zipContentsPath) {
  // Find the first .zip file in the directory
  const files = fs.readdirSync(zipContentsPath);
  const firstZipFile = files.find((file) => file.endsWith('.zip'));
  if (!firstZipFile) {
    throw new Error('No .zip files found in the specified directory.');
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
  core.info(`✅ Content Package Path: ${contentPackagePath}`);

  let extractedPaths = [];

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

  const isBoilerplate = isBoilerplatePackage(extractedPaths);

  return {
    isBoilerplate,
    contentPackagePath,
    pagePaths: extractedPaths,
  };
}

/**
 * Main function to run the boilerplate detector
 */
export async function run() {
  try {
    // Get inputs
    const zipContentsPath = core.getInput('zip_contents_path');

    // Validate inputs
    if (!zipContentsPath || !fs.existsSync(zipContentsPath)) {
      throw new Error(`Zip contents path not found: ${zipContentsPath}`);
    }

    core.info(`Checking if package is boilerplate: ${zipContentsPath}`);

    // Detect if this is a boilerplate package
    const result = await detectBoilerplate(zipContentsPath);

    // Set outputs
    core.setOutput('is_boilerplate', result.isBoilerplate.toString());
    core.setOutput('content_package_path', result.contentPackagePath);
    core.setOutput('page_paths', result.pagePaths.join(','));

    if (result.isBoilerplate) {
      core.info(`✅ Detected boilerplate package with ${result.pagePaths.length} paths: ${result.pagePaths.join(', ')}`);
    } else {
      core.info(`✅ Not a boilerplate package. Found ${result.pagePaths.length} paths: ${result.pagePaths.join(', ')}`);
    }
  } catch (error) {
    core.error(`Boilerplate detection failed: ${error.message}`);
    core.setOutput('error_message', `Boilerplate detection failed: ${error.message}`);
  }
}

await run();
