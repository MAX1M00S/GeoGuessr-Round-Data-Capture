# GeoGuessr Round Data Capture
A userscript for capturing GeoGuessr end-screen round data for personal analysis. Users are able to export round location, guess location, distance, score, pano ID, street view url data via CSV/JSON format. Stored captures through multiple games is supported.

## Features

- Captures round data from GeoGuessr result/end screens.
- Exports the current game as CSV or JSON.
- Stores captures across multiple games for combined CSV/JSON export.
- Supports retracting the most recent stored capture if you accidentally save unwanted data.
- Generates Google Maps Street View URLs using coordinates, heading, FOV, and pano ID when available.
- Normalizes hex-encoded pano IDs into regular Google pano IDs when possible.
- CURRENTLY ONLY WORKS PROPERLY FOR SINGLEPLAYER MODE!!!

## Files

- `geoguessr-round-capture.user.js` - Tampermonkey/Violentmonkey userscript for capturing GeoGuessr round data.

## Exported fields

Each exported row may contain:

- `captured_at`
- `page_url`
- `game_id`
- `round_number`
- `true_lat`
- `true_lng`
- `guess_lat`
- `guess_lng`
- `distance_km`
- `score`
- `time_seconds`
- `pano_id`
- `street_view_url`
- `data_source`

The generated `street_view_url` uses Google Maps Street View format, for example:

```text
https://www.google.com/maps/@42.1184927,72.8069192,3a,90y,227h,90t/data=!3m7!1e1!3m5!1sFZFwY86pB9iAtM0A45pXCA!2e0!6shttps%3A%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D0%26panoid%3DFZFwY86pB9iAtM0A45pXCA%26yaw%3D227!7i13312!8i6656?entry=ttu
```

If a pano ID is not available, the script falls back to a coordinate-based Street View URL.

## Setup

1. Install a browser userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/), or
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Create a new userscript.
3. Paste the contents of `geoguessr-round-capture.user.js`.
4. Save and enable the script.
5. Open `https://www.geoguessr.com/`.

## Usage

1. Play a GeoGuessr game normally.
2. Navigate to the game summary/end screen.
3. Click the floating `GeoGuessr Capture` button in the bottom-right corner.
4. Click `Capture page`.
5. Export the data using one of the download buttons.

## Button guide

- `Capture page` - captures rows from the currently open GeoGuessr result page and adds them to stored rows.
- `Download current CSV` - downloads only the rows from the current result page as CSV.
- `Download stored CSV` - downloads all rows stored across captures as CSV.
- `Download current JSON` - downloads only the rows from the current result page as JSON.
- `Download stored JSON` - downloads all rows stored across captures as JSON.
- `Retract last stored capture` - removes the most recent captured batch from stored rows.
- `Clear stored rows` - clears all stored rows, cached API data, and undo history.

## Current vs stored exports

`current` exports are for the game currently open in your browser. `stored` exports include everything the userscript has saved across captures until you clear the stored rows.

Example workflow:

1. Capture Game A: stored rows contain Game A.
2. Capture Game B: stored rows contain Game A and Game B.
3. Download stored CSV/JSON to export both games together.
4. If Game B was unwanted, click `Retract last stored capture`.

## Notes and limitations

- The script cannot directly scrape info on round score, so it has to calculate it manually, meaning that the same score calculation used for world maps is uniform across all map scales. WILL FOLLOW UP ON THIS LATER!!!
- This script is for personal post-game analysis and dataset building.
- GeoGuessr may change its frontend/API response shape, which can require updates to the extractor.
- Some fields may be blank if GeoGuessr does not expose them on the result page.
- Score extraction prefers exact values when available. If exact score data is missing, the script may calculate score from distance using the configured max-distance constant in the script.
- Street View URLs depend on Google Maps/Street View URL behavior and may change over time.
