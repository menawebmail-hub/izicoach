SESSION_STATE.md — IziCoach
CURRENT TASK
Pantalla Mis Alumnos — ajustes de Familias.
STATUS
In progress.
Claude recibió los requerimientos y comenzó la fase de análisis.
Último estado reportado:
	•	Desglosó los cambios solicitados.
	•	Identificó una implementación incremental.
	•	Empezó a analizar la implementación actual antes de modificar código.
	•	Todavía no está confirmado que haya realizado cambios de código.

REQUESTED CHANGES
1. Family card
Agregar debajo del nombre de la familia:
Representante: Nombre
Mantener debajo:
X miembros (Nombre y Nombre)
No modificar el diseño aprobado de la tarjeta.
2. Family representative
En Crear/Editar Familia:
	•	Permitir buscar y seleccionar un Student existente como representante.
	•	Si el representante no es alumno, permitir ingresar el nombre manualmente como actualmente.
	•	Si es Student, relacionarlo sin duplicar innecesariamente sus datos.
	•	Mantener student.familyId como fuente principal de membresía familiar.
	•	Revisar primero la implementación actual de Family antes de modificar el modelo.
3. Mis Alumnos filters
Reemplazar:
Todos | Activos | Inactivos
por:
Todos | Familias | Solo alumnos
Behavior:
	•	Todos → familias + alumnos que no pertenecen a una familia.
	•	Familias → solo tarjetas familiares.
	•	Solo alumnos → solo alumnos individuales.
Eliminar Activos/Inactivos como filtros principales.
4. Search
Mantener un único buscador que encuentre:
	•	familias
	•	alumnos
	•	representantes
5. Invite
Eliminar el botón Invitar.

CONSTRAINTS
	•	Preserve the current approved UI.
	•	Do not redesign Mis Alumnos or Family cards.
	•	Preserve student.familyId as the Family membership source of truth.
	•	Do not create duplicate Family/Student relationships or unnecessary duplicate data.
	•	Make incremental, minimal changes.
	•	Preserve existing functionality.

NEXT STEP
Continue the analysis of the current implementation.
Before editing:
	1	Inspect current Family and Student structures.
	2	Inspect Family create/edit representative flow.
	3	Locate Mis Alumnos family/student rendering.
	4	Locate current Todos / Activos / Inactivos filter logic.
	5	Locate current search logic.
	6	Identify the Invite button implementation.
	7	List the exact components/functions that require modification.
Then implement the changes incrementally following CLAUDE.md and ARCHITECTURE.md.
IMPORTANT
Do not restart the task from scratch.
First inspect the current Git/code state to determine whether Claude already made any partial changes after the last recorded message.
