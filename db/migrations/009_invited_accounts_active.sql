-- The user authorized immediate membership for invitees. Ordinary signups stay pending.
UPDATE users u SET status='active',approved_at=coalesce(u.approved_at,now())
FROM users inviter
WHERE u.status='pending' AND u.invited_by=inviter.id AND inviter.status='active'
  AND (inviter.is_admin OR u.sides <@ inviter.sides);
