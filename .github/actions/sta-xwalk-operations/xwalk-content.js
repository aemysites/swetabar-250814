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
 * Enhanced to handle multiple XML formats.
 * @param {string} xmlString
 * @returns {string[]}
 */
export function getFilterPaths(xmlString) {
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
    /<filter[^>]+root="([^"]+)"[^>]*>/g,
  ];

  for (const pattern of patterns) {
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(xmlString)) !== null) {
      const filterPath = match[1];
      if (filterPath && !paths.includes(filterPath)) {
        paths.push(filterPath);
      }
    }
  }

  return paths;
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

export async function doExtractContentPaths(zipContentsPath) {
  const contentPackagePath = getContentPackagePath(zipContentsPath);
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
