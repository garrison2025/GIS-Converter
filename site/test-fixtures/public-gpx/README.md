# Public-source GPS fixture provenance (P26)

These three **real, public repository GPX files** are reproduced unchanged from the `tkrajina/gpxpy` test corpus at revision `056cdfc34677f85b0185abffb855d2de01520da7`. This is distinct from P25's synthetic device-shaped load tests. Their original authors and upstream data collection are not independently authenticated; creator information inside the GPX is a source claim, not a verified manufacturer certificate. Use solely for offline browser regression tests. Do not republish raw GPS points in test reports.

| Local filename | Upstream fixture | Relevant cases |
| --- | --- | --- |
| `etrex20x-real-track.gpx` | [around-visnjan-with-car.gpx](https://github.com/tkrajina/gpxpy/blob/056cdfc34677f85b0185abffb855d2de01520da7/test_files/around-visnjan-with-car.gpx) | 104 timed/elevated points, a Garmin eTrex 20x creator tag, Garmin track extension namespace, full gx:Track export |
| `trainingcenter-empty-segment.gpx` | [track-with-empty-segment.gpx](https://github.com/tkrajina/gpxpy/blob/056cdfc34677f85b0185abffb855d2de01520da7/test_files/track-with-empty-segment.gpx) | 9 elevated/time-tagged points followed by a zero-point segment; ensures empty segments never cause fabricated vertices or false validation |
| `runkeeper-garmin-waypoint.gpx` | [gpx_with_garmin_extension.gpx](https://github.com/tkrajina/gpxpy/blob/056cdfc34677f85b0185abffb855d2de01520da7/test_files/gpx_with_garmin_extension.gpx) | One real-source public waypoint with Garmin-style heart-rate extension; remains a KML point, not a synthetic track |

**License:** source project Apache License 2.0, copy supplied as `LICENSE-Apache-2.0.txt`. Upstream project: https://github.com/tkrajina/gpxpy . No modifications to the three test fixture bytes.

**Privacy:** these are already-public GPS coordinates. They are used only in CI tests with local GDAL/WASM and are not emailed, uploaded to an analytics service or printed in quality JSON reports. Treat them as public sample *data*, not personal GPS content belonging to our site users.

**Limitations:** the records test input parsing and KML/KMZ structure in Chromium, not physical Garmin/Apple Watch devices or Google Earth Pro playback. A GPX may have software-generated or manually modified creator metadata; creator tags alone are not authenticity proof. Reproducible synthetic 1,920/3,500-point P25 fixtures remain separate stress data.
