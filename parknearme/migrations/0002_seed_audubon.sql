-- Starting point for the one camera the 2026-10-07 discovery run found clearly
-- useful (see CAMERA_FEASIBILITY.md): mark it watched and give it the lane
-- drawn on a real frame (seed/calibrations.json). Cameras get re-aimed, so
-- re-check it in /calibrate. No rows go into `cameras`: the catalog sync fills
-- that table on first use.
INSERT OR IGNORE INTO camera_preferences (camera_id, usefulness, notes, street_label, updated_at)
VALUES ('1ccb8d7c-43d4-450e-b40c-79527766db75', 'yes', 'Seeded: curb row of parked cars visible next to the camera (see CAMERA_FEASIBILITY.md).', 'W 181st St at Audubon Ave', '2026-10-07T00:00:00.000Z');

INSERT OR IGNORE INTO camera_calibrations (camera_id, regions_json, reference_width, reference_height, updated_at)
VALUES ('1ccb8d7c-43d4-450e-b40c-79527766db75', '[{"id":"lane-181-south","kind":"parking","label":"Left curb lane","streetLabel":"W 181st St at Audubon Ave","capacity":8,"points":[[0.128,1],[0.307,1],[0.432,0.533],[0.386,0.533]]},{"id":"roadway-181","kind":"roadway","label":"Travel + bus lanes","points":[[0.307,1],[0.9,1],[0.52,0.533],[0.432,0.533]]}]', 352, 240, '2026-10-07T00:00:00.000Z');
