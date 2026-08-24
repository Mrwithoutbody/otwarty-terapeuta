-- Two ways to present the same page, and the therapist picks: tinted sections
-- as framed panels (the default) or as bands running the full width of the
-- viewport. The heading follows suit - a card over a full-width band butts
-- straight into it - but she can override that on its own.
ALTER TABLE therapists ADD COLUMN layout_json TEXT NOT NULL DEFAULT '{}';
