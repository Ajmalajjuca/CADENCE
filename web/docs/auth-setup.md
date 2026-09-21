# Invitation setup

Disable public signup in Supabase Auth settings. Configure the site URL and allow the exact `/auth/callback` redirect URI for each environment. Invite beta users from the Supabase dashboard or `auth.admin.inviteUserByEmail`; do not create users through the public UI.

Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `APP_URL` on the web server. The sign-in endpoint requests a magic link with `shouldCreateUser: false`, and protected pages refresh and verify the current user in `src/proxy.ts`. API handlers must also call `requireUser()` and scope every database query to its returned ID.
