const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const targetDir = path.resolve(__dirname, '../node_modules/@prisma/engines');

const files = [
  {
    src: path.resolve(__dirname, '../schema-engine.exe.gz'),
    dest: path.join(targetDir, 'schema-engine-windows.exe')
  },
  {
    src: path.resolve(__dirname, '../query_engine.dll.node.gz'),
    dest: path.join(targetDir, 'query_engine-windows.dll.node')
  }
];

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function decompress(file) {
  return new Promise((resolve, reject) => {
    console.log(`Decompressing ${file.src} to ${file.dest}...`);
    
    if (!fs.existsSync(file.src)) {
      reject(new Error(`Source file does not exist: ${file.src}`));
      return;
    }

    const fileReader = fs.createReadStream(file.src);
    const gunzip = zlib.createGunzip();
    const fileWriter = fs.createWriteStream(file.dest);

    fileReader.pipe(gunzip).pipe(fileWriter);

    fileWriter.on('finish', () => {
      fileWriter.close();
      console.log(`Finished decompressing ${path.basename(file.dest)}`);
      // Delete temporary source file
      fs.unlink(file.src, () => {});
      resolve();
    });

    fileWriter.on('error', (err) => {
      fs.unlink(file.dest, () => {});
      reject(err);
    });

    gunzip.on('error', (err) => {
      fs.unlink(file.dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  try {
    for (const file of files) {
      await decompress(file);
    }
    console.log("All engines decompressed successfully!");
  } catch (error) {
    console.error("Decompression failed:", error);
    process.exit(1);
  }
}

main();
