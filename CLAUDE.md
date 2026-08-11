CLAUDE.md — IziCoach
PROJECT
IziCoach is an existing application for managing coaches, students, families, classes, attendance, packages, payments, and related operations.
Treat existing functionality as intentional unless the task explicitly requires changing it.
CORE RULES
	•	Understand the current implementation before changing code.
	•	Identify the root cause or exact implementation point first.
	•	Make the smallest safe change required.
	•	Do not modify unrelated functionality.
	•	Do not refactor unless necessary for the task.
	•	Preserve existing architecture, data flow, persistence, and state-management patterns.
	•	Avoid duplicate logic and second sources of truth.
	•	Check callers/dependencies before changing shared functions.
	•	Use functional React state updates when state depends on previous state.
	•	Do not use setTimeout() to work around state synchronization.
	•	Do not scan the entire repository unless necessary.
UI
Unless explicitly requested otherwise:
	•	Preserve the existing design system and interaction patterns.
	•	Reuse existing components, styles, SVG icons, buttons, spacing, typography, colors, borders, shadows, and states.
	•	Do not redesign screens while implementing functional changes.
TASK WORKFLOW
For each feature or bug:
	1	Locate the relevant code.
	2	Determine current behavior and dependencies.
	3	Identify the root cause or implementation point.
	4	Make the minimum necessary change.
	5	Verify the requested behavior and closely related existing behavior.
Do not claim something was tested unless it was actually tested.
DOCUMENTATION
Use project documentation as the source of truth:
	•	docs/PROJECT_CONTEXT.md — business rules, behavior, requirements and user flows.
	•	docs/ARCHITECTURE.md — data model, relationships, state architecture, constraints and technical decisions.
	•	docs/BUGS.md — important bugs, root causes, fixes and regressions to avoid.
	•	docs/SESSION_STATE.md — current unfinished task only.
For an interrupted task, read SESSION_STATE.md and inspect the current Git state before continuing. Do not restart the investigation unnecessarily.
Clear/update SESSION_STATE.md when the task is finished.
COMMUNICATION
After completing a task, report concisely:
	•	root cause/implementation point
	•	changes and files modified
	•	verification performed
	•	remaining risks or unverified areas
Avoid unnecessary explanations unless requested.
