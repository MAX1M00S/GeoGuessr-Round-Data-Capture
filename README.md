# GeoGuessr-Round-Data-Capture
A userscript for capturing GeoGuessr end-screen round data for personal analysis. Users are able to export round location, guess location, distance, score, pano ID, street view url data via CSV/JSON format. Stored captures through multiple games is supported.

## Files

- `geoguessr-round-capture.user.js` - Tampermonkey/Violentmonkey userscript for capturing end-screen round data.

## What the userscript captures

When data is available in the page runtime, each exported row contains:

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

The `street_view_url` column is generated like this:

```text
https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG
```

If heading is available, the script appends `&heading=...`.

## Setup

1. Install a browser userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/), or
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Create a new userscript.
3. Paste the contents of `geoguessr-round-capture.user.js`.
4. Save and enable the script.
5. Go to `https://www.geoguessr.com/`.

## Usage

1. Play a GeoGuessr game normally.
2. Navigate to the game summary/end screen.
3. Click the floating `GeoGuessr Capture` button in the bottom-right corner.
4. Click `Capture page`.
5. Use one of:
   - `Download current CSV` for the current end screen only.
   - `Download stored CSV` for all rows captured by the userscript so far.
   - `Copy current JSON` for debugging or manual import.

## Notes and limitations

- The script does not automate gameplay.
- The script does not make background requests to GeoGuessr.
- It only attempts to read data that is already loaded in the current page/runtime.
- GeoGuessr can change their frontend data shape at any time, so selectors/extraction may need adjustments.
- If the script reports zero rows, open the browser console and inspect whether the results page exposes round data in `window.__NEXT_DATA__` or another runtime store.
- Use this for personal post-game analysis and dataset building, not real-time competitive assistance.
