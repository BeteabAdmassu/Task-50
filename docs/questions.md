# Business Logic Questions Log

1. [Planning Authorization]
   - **Question**: How should site-level and object-level permissions be strictly enforced for planning users creating or interacting with MPS, MRP, Work Orders, and Adjustments?
   - **My Understanding**: Planners/Supervisors should only see or alter records within their own assigned site. Admins have cross-site privileges.
   - **Solution**: Updated planning services and API checking logic (in `/api/planning/*`) to explicitly deny actions or filter records when the session user's site does not match the target site, unless the role is `ADMIN`.

2. [Candidate Attachment Upload Flow]
   - **Question**: How can unauthenticated candidates securely upload their attachments (e.g., resumes) without full API authorization?
   - **My Understanding**: The system needs a temporary, scoped credential associated with the newly created application record.
   - **Solution**: The backend `createCandidateApplication` flow was configured to issue an `uploadToken`. The frontend UI was updated to extract this token on application creation and send it via the `x-candidate-upload-token` header for the subsequent `/api/hr/applications/:id/attachments` request.

3. [Search Data Isolation]
   - **Question**: How should free-text search prevent cross-site or cross-tenant data spillage?
   - **My Understanding**: Search queries must respect the same RBAC and site limitations as standard CRUD queries.
   - **Solution**: Integrated role and site-aware filters directly into the search service/route so that clerks, planners, and interviewers only receive search hits for data corresponding to their site/ownership rules.

4. [Sensitive Data Access]
   - **Question**: When should sensitive candidate or system data be masked vs unmasked? 
   - **My Understanding**: Only users with explicit rights to view sensitive PII should see the raw data.
   - **Solution**: Introduced an explicit `SENSITIVE_DATA_VIEW` permission flag. The API layer uses this permission check to selectively unmask sensitive fields (like SSNs or DOBs), defaulting to masked for everyone else.

5. [Notification Scheduling Boundaries]
   - **Question**: How should the system handle recurring scheduled notifications (e.g., DAILY 6:00 PM) if they conflict with Do-Not-Disturb (DND) boundaries or have already passed for the current day?
   - **My Understanding**: It should not send in DND mode and must robustly roll over to the next valid designated slot without skipping or infinitely looping.
   - **Solution**: Updated the `notification-service.js` timing logic with edge-correct boundary checks, ensuring delivery time cleanly resolves to the next valid unblocked timeslot.
