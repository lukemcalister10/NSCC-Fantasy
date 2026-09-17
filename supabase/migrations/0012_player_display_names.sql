-- Use the familiar short names shown to fantasy users while retaining each
-- player's registry_key for scorecard matching.
UPDATE players
SET display_name = CASE display_name
  WHEN 'Jonathan Villanueva' THEN 'Jono Villanueva'
  WHEN 'Benjamin O''Sullivan' THEN 'Ben O''Sullivan'
  WHEN 'Joshua Marks' THEN 'Josh Marks'
  WHEN 'Shivam Patel' THEN 'Shiv Patel'
  WHEN 'Matthew Smith' THEN 'Mat Smith'
  WHEN 'Charles Antoniades' THEN 'Charlie Antoniades'
  WHEN 'Nischal Pangeni' THEN 'Nish Pangeni'
  WHEN 'Joshua Smythe' THEN 'Josh Smythe'
  WHEN 'Lakshman Nirthanakumaran' THEN 'Laksh Nirthanakumaran'
  ELSE display_name
END
WHERE display_name IN (
  'Jonathan Villanueva',
  'Benjamin O''Sullivan',
  'Joshua Marks',
  'Shivam Patel',
  'Matthew Smith',
  'Charles Antoniades',
  'Nischal Pangeni',
  'Joshua Smythe',
  'Lakshman Nirthanakumaran'
);
