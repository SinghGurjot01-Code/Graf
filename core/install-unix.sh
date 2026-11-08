#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<5)){console.error('Graf requires Node.js 22.5+');process.exit(1)}"
npm test
npm run check
npm link
echo "Graf CLI installed. Open a repository and run: graf init"
