-- Correct the customer-facing spelling while retaining the registry key used
-- for scorecard matching.
UPDATE players
SET display_name = 'Jaan Tulsiani'
WHERE display_name = 'Jaan Tulsani';
