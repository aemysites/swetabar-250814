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

import fs from 'fs';
import path from 'path';
import core from '@actions/core';
import unzipper from 'unzipper';

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

export async function doExtractContentPaths(zipContentsPath) {
  const contentPackagePath = getContentPackagePath(zipContentsPath);
  
  // Check if this is boilerplate content (no zip file, but META-INF directory exists)
  const metaInfPath = path.join(zipContentsPath, 'META-INF', 'vault', 'filter.xml');
  const isBoilerplateContent = !contentPackagePath && fs.existsSync(metaInfPath);
  
  if (isBoilerplateContent) {
    core.info('✅ Detected boilerplate content - reading filter.xml directly');
    core.setOutput('content_package_path', ''); // No zip file for boilerplate
    
    try {
      const filterContent = fs.readFileSync(metaInfPath, 'utf8');
      core.debug(`Filter XML content: ${filterContent}`);
      const paths = getFilterPaths(filterContent);
      core.setOutput('page_paths', paths);
      core.info(`✅ Extracted ${paths.length} page paths from boilerplate content: ${paths.join(', ')}`);
      return paths;
    } catch (error) {
      throw new Error(`Error reading filter.xml from boilerplate content: ${error.message}`);
    }
  }
  
  if (!contentPackagePath) {
    throw new Error('No .zip files found in the specified directory and no boilerplate content detected.');
  }
  
  core.info(`✅ Content Package Path: ${contentPackagePath}`);
  core.setOutput('content_package_path', contentPackagePath);

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
              core.setOutput('page_paths', paths);
              resolve(paths);
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
