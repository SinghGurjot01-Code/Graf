# Graf

Graf is a local-first project intelligence layer for AI coding agents.

## Build the Windows desktop installer

The Windows build workflow is configured at [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml).

### 1. Add the Graf Desktop source

The repository must contain the Graf Desktop application source. Upload the file named:

`Graf-Desktop-v1.0.0-source.zip`

to the **repository root** (the same level as this README), then commit it to `main`.

The archive must contain this path:

`graf-desktop/package.json`

Alternatively, extract the archive locally and upload the entire `graf-desktop/` folder to the repository root. Do not upload only the nested `src/` folder.

### 2. Let GitHub build it

A push containing the source ZIP or the extracted `graf-desktop/` folder automatically starts **Build Graf for Windows**.

The workflow runs on a Windows runner and:
- Installs Node.js 24 and dependencies.
- Runs JavaScript syntax checks.
- Runs the Node test suite serially to avoid Windows file-lock races.
- Builds the x64 NSIS installer.
- Uploads `Graf-Setup-1.0.0-x64.exe` as the `Graf-Windows-x64` Actions artifact for 30 days.

Open the [Actions tab](../../actions) and select the latest successful **Build Graf for Windows** run. Download the `Graf-Windows-x64` artifact from the run's Artifacts section.

### 3. Publish a Release (optional)

When the workflow is run for a published Git tag/release, it also attaches the EXE to the GitHub Release.

### If the build says source is missing

The workflow now reports this as a skipped build with a notice instead of a failed test run. This means the source ZIP or extracted folder has not reached the repository yet. Upload it using step 1.

