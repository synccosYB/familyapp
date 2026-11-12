# Password recovery

Members choose **פארגעסן דאס פאסווארט?** on the login screen and enter their registered phone number. When Resend is configured, a one-hour reset link is sent to their verified recovery email. Otherwise the request appears in the admin page under **פאסווארט בקשות**. The public response is identical for registered and unknown numbers.

Members verify an email from My Account by confirming their current password and following the email link. A locked-out administrator can then recover without another administrator. Without a verified email, an administrator verifies the person's identity through an established contact, creates a reset link, and shares it privately using the existing WhatsApp or copy controls. SMS delivery is not connected. A submitted phone number alone is not proof of identity. If the only administrator is locked out without a verified email, an operator must assist.

Reset links expire after one hour. Creating another link invalidates previous unused links. Successful recovery consumes the token, invalidates remaining tokens and existing sessions, clears the request, and signs in the recovering user. Only token hashes are stored. Unknown, expired and used links show an error and a control to request a new link.

Deploy migration `004_password_reset_requests.sql` through the normal bootstrap before starting the new API. Set `PUBLIC_URL` to the canonical published HTTPS address, for example `https://kobor.it.com`, so links point to the correct domain. Deploy the API and web assets together.

Validation: `npm test` with `TEST_DATABASE_URL` pointed at a disposable PostgreSQL database exercises request deduplication, admin permissions, generic responses, expiry, link replacement, concurrent consumption, password changes, session revocation and throttling. The integration test uses its own isolated schema.
