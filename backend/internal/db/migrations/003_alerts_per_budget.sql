-- Each budget amount gets its own 80% / 100% alerts in a month. Changing a member's or the team's budget therefore
-- allows fresh alerts for the new amount (from any screen) without deleting the alert history.
ALTER TABLE budget_alerts DROP CONSTRAINT budget_alerts_pkey;
ALTER TABLE budget_alerts ADD PRIMARY KEY (user_id, month, threshold, budget_cents);
