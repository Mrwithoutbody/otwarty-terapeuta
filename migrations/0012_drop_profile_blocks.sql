-- `profile_blocks` (0008) is dead. 0010 kept it as the fallback spine for a
-- profile with no sections, but that spine is a constant in the renderer
-- (`DEFAULT_ORDER` in src/web/sections.ts) and nothing has read the column
-- since. A column nobody reads is a column that will be believed one day.
ALTER TABLE therapists DROP COLUMN profile_blocks;
