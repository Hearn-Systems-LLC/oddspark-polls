-- Vote-row deletes (via poll cascade) must find claims by vote_id without a
-- table scan per vote row. This index was first committed as an in-place
-- edit to 0006 — forward-only immutability (AD-14) forbids that, and any
-- database that had already applied 0006 would never have received it.
CREATE INDEX voter_claim_vote_id_idx ON voter_claim(vote_id);
