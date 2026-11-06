# Graf

Graf is a local-first project intelligence layer for AI coding agents.

## Build the Windows desktop installer with GitHub Actions

The repository was empty when the workflow was added, so the workflow is ready but the application source still needs to be uploaded once.

1. Download the [Graf Desktop source ZIP](https://github.com/SinghGurjot01-Code/Graf/releases) from the conversation attachment or use the ZIP created for this project.
2. Open this repository on GitHub and choose **Add file → Upload files**.
3. Upload **Graf-Desktop-v1.0.0-source.zip** to the repository root and commit it to `main`.
4. GitHub Actions will run automatically. Open the **Actions** tab, select **Build Graf for Windows**, and wait for the job to finish.
5. Open the successful run and download the **Graf-Windows-x64** artifact. It contains `Graf-Setup-1.0.0-x64.exe`.

You can also upload the extracted `graf-desktop/` folder contents to the repository root instead of uploading the ZIP. The workflow recognizes either layout.

### What the workflow does

- Runs on GitHub's Windows runner.
- Installs Node.js 22 and project dependencies.
- Runs `npm run check` and `npm test`.
- Builds the x64 NSIS installer with `npm run build:win`.
- Uploads the installer as a 30-day Actions artifact.
- When you publish a Git tag/release (for example `v1.0.0`), attaches the installer to the GitHub Release.

The workflow is at [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml).

**Important:** the first workflow commit only adds the build automation. The installer cannot be built until the Graf Desktop source ZIP or extracted source folder is committed to the repository.
