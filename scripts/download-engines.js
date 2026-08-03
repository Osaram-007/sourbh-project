const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const commit = 'c2990dca591cba766e3b7ef5d9e8a84796e47ab7';
const targetDir = path.resolve(__dirname, '../node_modules/@prisma/engines');

const engines = [
  {
    url: `https://binaries.prisma.sh/all_commits/${commit}/windows/schema-engine.exe.gz`,
    dest: path.join(targetDir, 'schema-engine-windows.exe')
  },
  {
    url: `https://binaries.prisma.sh/all_commits/${commit}/windows/query_engine.dll.node.gz`,
    dest: path.join(targetDir, 'query_engine-windows.dll.node')
  }
];

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function downloadAndDecompress(engine) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${engine.url} to ${engine.dest}...`);
    
    https.get(engine.url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download engine: HTTP ${response.statusCode}`));
        return;
      }

      const gunzip = zlib.createGunzip();
      const fileWriter = fs.createWriteStream(engine.dest);

      response.pipe(gunzip).pipe(fileWriter);

      fileWriter.on('finish', () => {
        fileWriter.close();
        console.log(`Finished writing ${path.basename(engine.dest)}`);
        resolve();
      });

      fileWriter.on('error', (err) => {
        fs.unlink(engine.dest, () => {});
        reject(err);
      });
      
      gunzip.on('error', (err) => {
        fs.unlink(engine.dest, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    for (const engine of engines) {
      await downloadAndDecompress(engine);
    }
    console.log("All engines downloaded and decompressed successfully!");
  } catch (error) {
    console.error("Failed to download engines:", error);
    process.exit(1);
  }
}

main();
