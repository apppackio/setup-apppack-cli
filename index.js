const core = require("@actions/core");
const os = require("os");
const tc = require("@actions/tool-cache");
const https = require("https");
const { join } = require("path");

async function run() {
  try {
    // Get the version input or the latest release
    let version = core.getInput("version") || "latest";

    // Get the download URL for the release
    const releaseUrl = `https://api.github.com/repos/apppackio/apppack/releases/${version}`;
    const data = await downloadJson(releaseUrl);
    
    // Validate the API response
    if (!data || !data.tag_name) {
      throw new Error(
        `Failed to fetch release information for version '${version}'. ` +
        `Please check if the version exists or try 'latest'.`
      );
    }
    
    if (!data.assets || data.assets.length === 0) {
      throw new Error(
        `No assets found for release ${data.tag_name}. ` +
        `This may be a draft release or the release process may have failed.`
      );
    }
    
    // strip the leading "v" from the tag name
    version = data.tag_name.slice(1);
    // Determine the platform-specific asset name
    const arch = process.arch === "x64" ? "x86_64" : process.arch;
    const platform =
      process.platform.charAt(0).toUpperCase() +
      process.platform.slice(1) +
      "_" +
      arch;
    const assetName = `apppack_${version}_${platform}.tar.gz`;
    const asset = data.assets.find((a) => a.name === assetName);

    if (!asset) {
      throw new Error(
        `Could not find AppPack CLI asset in release ${data.tag_name}`
      );
    }

    // Download and cache the AppPack CLI tool
    const downloadUrl = asset.browser_download_url;
    const pathToTarball = await tc.downloadTool(downloadUrl);
    const tmpDir = process.env.RUNNER_TEMP || os.tmpdir();
    const pathToCLI = await tc.extractTar(pathToTarball, tmpDir);

    // Cache the downloaded tool
    const toolPath = await tc.cacheFile(
      join(pathToCLI, "apppack"),
      "apppack",
      "apppack",
      data.tag_name
    );

    // Add the AppPack CLI directory to the PATH
    core.addPath(toolPath);
    // Set the version output
    core.setOutput("version", version);
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Download a JSON file from a URL
async function downloadJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "apppackio/setup-apppack" } },
      (res) => {
        let data = "";
        
        // Check for non-success status codes
        if (res.statusCode !== 200) {
          if (res.statusCode === 404) {
            reject(new Error(`Release not found (404). Please check if the version exists.`));
          } else {
            reject(new Error(`GitHub API request failed with status ${res.statusCode}`));
          }
          return;
        }
        
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse GitHub API response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", (e) => {
      reject(new Error(`Network error accessing GitHub API: ${e.message}`));
    });
  });
}

run();
