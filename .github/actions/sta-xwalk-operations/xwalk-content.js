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
  core.info(`🔍 Analyzing directory: ${zipContentsPath}`);
  
  // List directory contents for debugging
  try {
    const files = fs.readdirSync(zipContentsPath);
    core.info(`📁 Directory contents: ${files.join(', ')}`);
    
    // Check for META-INF directory
    const metaInfDir = path.join(zipContentsPath, 'META-INF');
    if (fs.existsSync(metaInfDir)) {
      const metaInfFiles = fs.readdirSync(metaInfDir);
      core.info(`📁 META-INF contents: ${metaInfFiles.join(', ')}`);
      
      const vaultDir = path.join(metaInfDir, 'vault');
      if (fs.existsSync(vaultDir)) {
        const vaultFiles = fs.readdirSync(vaultDir);
        core.info(`📁 META-INF/vault contents: ${vaultFiles.join(', ')}`);
      }
    }
  } catch (error) {
    core.warning(`Could not list directory contents: ${error.message}`);
  }
  
  const contentPackagePath = getContentPackagePath(zipContentsPath);
  
  // Check if this is boilerplate content (no zip file, but META-INF directory exists)
  const metaInfPath = path.join(zipContentsPath, 'META-INF', 'vault', 'filter.xml');
  const isBoilerplateContent = !contentPackagePath && fs.existsSync(metaInfPath);
  
  if (isBoilerplateContent) {
    core.info('✅ Detected boilerplate content - reading filter.xml directly');
    core.info(`📁 Reading filter.xml from: ${metaInfPath}`);
    core.setOutput('content_package_path', ''); // No zip file for boilerplate
    
    try {
      const filterContent = fs.readFileSync(metaInfPath, 'utf8');
      core.info(`📄 Filter XML content (${filterContent.length} characters):`);
      core.info(`${filterContent}`);
      const paths = getFilterPaths(filterContent);
      core.info(`🔍 Parsed paths: [${paths.map(p => `"${p}"`).join(', ')}]`);
      core.setOutput('page_paths', paths);
      core.info(`✅ Extracted ${paths.length} page paths from boilerplate content: ${paths.join(', ')}`);
      return paths;
    } catch (error) {
      core.error(`❌ Error reading filter.xml from boilerplate content: ${error.message}`);
      core.info(`📁 Checking if file exists: ${fs.existsSync(metaInfPath)}`);
      if (fs.existsSync(metaInfPath)) {
        const stats = fs.statSync(metaInfPath);
        core.info(`📊 File stats - Size: ${stats.size} bytes, Modified: ${stats.mtime}`);
      }
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
