SESSION_STATE.md — IziCoach

# HANDOFF — Auditoría y migración incremental de Auth + Data/Persistence

Reemplaza por completo el estado anterior de este archivo (tarea de
Familias/Mis Alumnos/Cobros/Portal del Alumno — ya cerrada y commiteada
hace varias sesiones, sin relación con esto).

## 1. Estado del repo al cierre de esta sesión

- Path: `/Users/ricardomena/izicoach`
- Branch: `main`
- HEAD local: `e4476c05616e052b971458b3d8c84c733d59d78f` — "refactor: make coach onboarding persistent" (Fase C)
- Ahead/behind vs `origin/main`: **2 ahead / 0 behind** (Fase B + Fase C, ninguna pusheada todavía)
- `git status`: working tree limpio salvo `.claude/` sin trackear (no forma parte de ningún commit)
- Build: limpio. Lint (`oxlint`): 371 warnings/errors, todos preexistentes a esta sesión (baseline estable, sin regresiones introducidas en A/B/C — verificado por diff de contenido, no solo de conteo, en cada fase)

### Commits de esta sesión (ninguno pusheado)

```
e4476c0  refactor: make coach onboarding persistent          (Fase C)
03a5a4a  refactor: establish safe coach data loading layer   (Fase B, incluye Fase A)
8bdc139  fix: scope payment detail to active combo           (BUG-4, sesión anterior, ya en origin)
```

**Importante:** Fase A (state de negocio arranca vacío + `dataReady`) **no tiene commit propio** — se implementó, se probó, y quedó incluida dentro del commit de Fase B (`03a5a4a`) junto con la extracción de `data/coachData.js` y `services/supabaseClient.js`.

## 2. Problema original que se está solucionando

Un entrenador nuevo se registró en IziCoach y, antes de crear su primera clase, la app ya le mostraba alumnos y clases que nunca había creado (datos de otro coach). Al investigar además apareció un segundo síntoma: un coach que ya había completado el registro y el onboarding, al desloguearse y volver a entrar, terminaba viendo las pantallas de onboarding de nuevo, como si fuera una cuenta nueva.

La causa raíz combinaba dos problemas de arquitectura, no bugs puntuales:
1. **Aislamiento de datos por coach inexistente**: `students/classes/courts/packages/families/expenses` se inicializaban leyendo `localStorage` global (no namespaced por coach) al montar la app, antes de resolver cualquier identidad — cualquier residuo de una sesión anterior en el navegador se mostraba y, peor, se sincronizaba de forma permanente a Supabase bajo el `coachId` de quien fuera que estuviera logueado en ese momento.
2. **Onboarding no transaccional**: el estado "onboarded" solo vivía en React state/localStorage, nunca confirmado contra Supabase; dos escrituras a `coaches` (insert de signup + upsert de onboarding, esta última además duplicada por un upsert oculto) no verificaban error antes de avanzar.

## 3. Decisiones arquitectónicas definitivas (aprobadas, en ejecución incremental)

Arquitectura objetivo aprobada: `AuthProvider → CoachDataProvider → App`, migración **incremental**, sin rewrite, preservando el 100% de las reglas de negocio actuales (clases, combos, pagos, asistencia, reprogramaciones, familias, agenda, finanzas — nada de esto se tocó ni se debe tocar en este trabajo).

Fases aprobadas, en este orden:
- **A** — aislamiento inmediato / state de negocio arranca vacío — ✅ hecho (dentro del commit de Fase B)
- **B** — capa `data/coachData.js` con errores explícitos (`{ok,data|error}`), cliente Supabase extraído a `services/supabaseClient.js` — ✅ hecho, commiteado
- **C** — perfil de coach + onboarding persistente (`coaches.onboarded`) — ✅ hecho, commiteado
- **D** — `AuthProvider` + extracción de `resolveSession` a módulo/contexto — **siguiente paso, no empezado**
- **E** — `CoachDataProvider` + migración de la persistencia (setters con write oculto → API de escritura explícita) — no empezado, fase de mayor riesgo
- **F** — cache de localStorage namespaced por coach (opcional, solo si se decide que hace falta) — no empezado
- **G** — extracción de `features/` (mover pantallas grandes de `App.jsx` a archivos propios) — opcional, sin prisa
- **RLS/migrations versionadas** — workstream paralelo, requisito antes de ampliar el uso real a múltiples coaches — no empezado, requiere acceso al dashboard de Supabase que solo tiene el usuario

Localstorage: **no es cache durante esta migración** — las keys `izi_students/classes/courts/packages/families/expenses` quedan físicamente intactas en los navegadores existentes pero **inactivas**: ningún camino del código las lee ni las usa como fuente. El cache namespaced (Fase F) queda para después, deliberadamente no mezclado con este trabajo.

## 4. Migración `coaches.onboarded` — estado real, ya ejecutada en producción

El usuario ejecutó esto directamente en el SQL Editor de Supabase (yo nunca tengo ni debo tener acceso de escritura DDL — sin `service_role`, sin dashboard):

```sql
begin;
alter table coaches add column onboarded boolean not null default false;
update coaches set onboarded = true where name is not null and name <> '';
commit;
```

**Resultados post-migración, confirmados por el usuario:**
- `onboarded_true = 5`
- `onboarded_false = 0`
- `total = 5`
- Coaches con `name` válido pero `onboarded=false`: 0 filas
- Coaches sin `name` válido pero `onboarded=true`: 0 filas

Backfill consistente y conservador — no mandó a ningún coach existente de vuelta al onboarding.

## 5. Caso real — `guilleg_tenis@hotmail.com`

**Confirmado por el usuario.** Es la cuenta del incidente original: el coach que creó su cuenta, completó el setup, vio alumnos/clases que no le correspondían (datos de otro coach) y, al desloguearse y volver a entrar, la app le mostró nuevamente el onboarding.

Verificado manualmente por el usuario en Supabase SQL Editor (solo lectura):
- email: `guilleg_tenis@hotmail.com`
- `auth.users`: existe — user id `40b113fe-0bbf-4552-9834-38b21d45092b`
- `coaches`: **no existe ninguna fila** para ese id

Estado real confirmado: `auth.users` existe → `coaches` no existe. Consistente con el bug de arquitectura anterior — la autenticación podía completarse aunque la persistencia del perfil de coach fallara, sin bloquear el flujo (la misma causa raíz descrita en la sección 2).

**✅ Prueba de recuperación ejecutada por el usuario y PASÓ**, contra Fase D ya implementada (no Fase C — la recuperación real se probó una vez que `resolveSession`/hidratación vivían en `auth/` + el fix de identidad de la sección 8.1). Resultado real, paso a paso, confirmado por el usuario:
```
login (auth.users existía, coaches no) → mostró onboarding correctamente
  → onboarding completado desde localhost → fila coaches creada correctamente
  → se creó una clase → logout → nuevo login
  → NO volvió a mostrar onboarding → los datos creados permanecieron
```
Confirmado además contra Supabase real (no solo la UI): la fila de `coaches` se creó en la base. Sin ninguna escritura manual de `auth.users`/`coaches` por SQL — todo por el flujo normal de la app, como exigía la restricción de la sección anterior.

**Restricción que se mantuvo:** no se modificó manualmente `auth.users` ni se creó la fila de `coaches` por SQL en ningún momento.

## 6. Prueba E2E — cubierta por la recuperación de la sección 5

```
signup real con cuenta descartable → onboarding → fila coaches con
onboarded=true → logout → login directo al dashboard
```

Cubierta en la práctica por la prueba de recuperación de `guilleg_tenis@hotmail.com` (sección 5) — mismo camino de escritura (`onboarding → upsert único a coaches → logout → login → dashboard directo`), ejecutada y pasada por el usuario. No se creó ninguna cuenta nueva desde cero (Claude sigue sin crear cuentas reales, sin excepción) — se usó una cuenta `auth.users` ya existente de una sesión anterior, exactamente el escenario de recuperación de cuenta parcial que esta prueba buscaba cubrir.

## 7. Deudas técnicas registradas (no urgentes, documentadas para Fase D/E)

- `dataReady` / `dataLoadFailed` — temporales, deben convertirse en el `idle|loading|ready|error` de `CoachDataProvider` (Fase E). No agregarles más responsabilidades mientras tanto.
- Los dos `useEffect` de autosync fire-and-forget desaparecen/se replantean en Fase E, reemplazados por una API de escritura explícita que exija `coachId`.
- `_syncQueue`/`_syncPrevLen` en `data/coachData.js` — keyed solo por `key` (ej. "students"), no por `coachId`. Inofensivo hoy (un solo coach activo por navegador), pero debe rediseñarse junto con el autosync.
- `window._iziUserId` — debe desaparecer cuando la identidad viva en `AuthProvider`/`CoachDataProvider`. No reemplazar por otro global.
- `window.supabase` — revisar si tiene una necesidad productiva real (hoy solo parece usarse para debugging manual) o eliminarlo.
- El upsert oculto en la pantalla de Configuración/Perfil (edición post-onboarding, `handleSaveProfile` → `setCoachProfile`) sigue sin verificar error — no afecta el gate de onboarding (que ya no depende de él), pero es el mismo patrón de fallo silencioso, sin tocar todavía.
- RLS de `coaches`/`coach_data` no está versionado en el repo (sin migraciones SQL) — verificado empíricamente que protege la fila propia (rechaza escritura con `coach_id`/`id` ajeno), pero no hay policies como código revisable.

## 8. Fase D — implementada, verificada en vivo y VALIDADA

Plan operativo escrito y aprobado por el usuario (con 5 decisiones explícitas: dónde montar `AuthProvider`, reset de `resolvedUserIdRef` en logout, mecanismo del gate identidad→datos, alcance de `window._iziUserId`, tratamiento caso por caso de los tres `onExit`). Implementado sobre esa aprobación:

- Archivos nuevos: `src/auth/AuthContext.js`, `src/auth/resolveSession.js` (identity-only: `queryProfile` + `resolveSession`, ya no toca `loadData`/`dataReady`/`dataLoadFailed`/setters de datos — no tiene acceso a esos closures), `src/auth/AuthProvider.jsx` (estado de identidad: `user/mode/onboarded/loadingAuth/checkingProfile/onboardingSaveFailed`, el listener `onAuthStateChange`, `logout()` — resetea `resolvedUserIdRef` por decisión explícita del usuario), `src/auth/useAuth.js`.
- `main.jsx`: envuelve `<App/>` con `<AuthProvider>` (no dentro de `App.jsx` — así `App` puede consumir `useAuth()` sin partirse en más componentes).
- `App.jsx`: destructura `useAuth()` con los mismos nombres locales que tenía el estado viejo (`user,mode,onboarded,setUserWithRef,setModeP,setOnboardedP,resolvedUserIdRef,resolveSession,...`) — mínimo diff en el resto del archivo. Se agregó un efecto nuevo (`[mode,user?.id]`) que reemplaza lo que `resolveSession` hacía inline para `coach`/`coach_new`/`student_portal`/sign-out (llamar `loadData`, hidratar `students/classes/families` del alumno, setear `dataReady`/`dataLoadFailed`) — necesario para las dos ramas (`coach` y `student_portal`), no solo `coach`, porque ninguna de las dos puede ejecutarse dentro de `AuthProvider` (closures de `App.jsx`, inalcanzables desde un ancestro). Gate de render extendido (`awaitingBusinessData`) para que ni el dashboard del coach ni el portal del alumno rendericen antes de que `dataReady` sea `true` — reutiliza `dataReady`/`dataLoadFailed` tal cual, sin estado nuevo. `window._iziUserId` eliminado por completo (todas las lecturas → `user?.id`); `localStorage("izi_userId")` eliminado (auditado: solo se alimentaba a sí mismo, sin otro consumidor).
- Los tres `onExit` de alumno revisados individualmente: `student_portal` (sesión real de Supabase Auth) → `auth.logout()`. `student_new`/`student` → confirmados código muerto (su único disparador, `handleLogin(role)` en `App.jsx:6785`, no lo llama nada en todo el archivo — corroborado además por lint baseline, que ya marcaba `handleLogin` como variable no usada). Se les asignó `auth.logout()` solo para que compilen tras mover el estado; marcado explícitamente para el usuario, no es una decisión de negocio.

**Verificado:** `vite build` limpio. `oxlint` — comparado contra un baseline correctamente aislado (mismo binario del proyecto, no el de un `git worktree` sin `node_modules`, que dio un número falso al principio): 102 → 104 en `App.jsx`, +2 warnings `react-hooks(exhaustive-deps)` — misma categoría ya tolerada 3 veces en este archivo antes del cambio, causada porque `user?.id` (ahora reactivo) reemplazó a `window._iziUserId` (invisible para el linter). No se agregaron los deps faltantes porque hacerlo cambiaría el comportamiento de los efectos (re-ejecutarían en cada render). `git diff --check` limpio.

### 8.1 Auditoría posterior — condición de carrera en la hidratación, cerrada antes de aprobar

Antes de las pruebas runtime, se auditó (y luego se corrigió) una condición de carrera real en el efecto de hidratación de datos de negocio, encontrada por el usuario al revisar el diseño:

- **Carga obsoleta que escribe tarde:** una `loadData(A)` en vuelo podía completar después de que la identidad ya cambió a `B` (o a `null` por logout), escribiendo los datos de A bajo la sesión de B. Sin protección alguna (ni `AbortController` ni chequeo de vigencia) antes de este fix.
- **`dataReady`/`dataLoadFailed` sin dueño:** eran booleanos crudos sin asociación a qué identidad los produjo — un `dataReady=true` de A podía bloquear la carga real de B (`if(dataReady||dataLoadFailed) return;` no distinguía de quién era), y durante la ventana entre "la identidad ya es B" y "la carga de B terminó", `dataReady` seguía leyendo `true` (de A) — alcanzando al autosync, al visibility handler y al gate de render del dashboard: los tres podían actuar sobre datos de A creyendo que eran de B. Confirmado como alcanzable, no solo teórico.

**Fix implementado (todo en `App.jsx`, nada en `auth/`):**
- `activeIdentityRef` (ref) — identidad de la invocación más reciente del efecto de hidratación, escrita de forma síncrona como primera línea del efecto.
- `hydratedIdentityRef` (ref) — identidad para la cual `dataReady`/`dataLoadFailed` efectivamente se asentaron (éxito o fallo).
- `dataReadyForCurrentIdentity`/`dataLoadFailedForCurrentIdentity` — valores derivados (`const`, recalculados en cada render, no `useState` nuevo) que combinan el booleano crudo con el chequeo de identidad. Reemplazan a `dataReady`/`dataLoadFailed` crudos en **todos** los gates sensibles: guard de entrada del efecto de hidratación (las 3 ramas: `coach`, `coach_new`, `student_portal`), pantalla de error/retry, efecto de autosync, visibility handler, y `awaitingBusinessData` (gate de render del dashboard). Los booleanos crudos siguen existiendo solo para ser *seteados* (`setDataReady`/`setDataLoadFailed`), nunca para gatear nada directamente.
- Chequeo de vigencia (`if(activeIdentityRef.current!==myUserId) return;`) insertado después de cada punto de `await` que pueda derivar en un setter: dentro de `loadData` (sus dos awaits internos — el de negocio y el del perfil del coach), en la rama `student_portal` del efecto (inline, no pasa por `loadData`), y en `retryLoadData`.

Se confirmó explícitamente que un `ref` alcanza (no hace falta `useState` para la identidad hidratada): toda mutación de `hydratedIdentityRef`/`activeIdentityRef` va acompañada de un setter real que ya fuerza el re-render necesario; los valores derivados se recalculan frescos en cada render, así que nunca hay lectura obsoleta del ref.

No se introdujo `AbortController`, ninguna abstracción nueva de data layer, ni `CoachDataProvider`/máquina de estados — se adelantó explícitamente que este cierre de hueco no debía anticipar la Fase E, y no lo hace: `dataReady`/`dataLoadFailed` siguen siendo los mismos dos booleanos sin renombrar ni reestructurar, y el autosync/sync API de escritura explícita (deuda ya documentada para Fase E) no se tocó.

**Verificado tras el fix:** build limpio, lint (+2 sobre baseline, mismos 2 de antes, misma categoría/justificación), `git diff --check` limpio, grep confirma cero `window._iziUserId` en el árbol activo.

### 8.2 Pruebas runtime — ejecutadas por el usuario, PASARON

El navegador de la herramienta de Claude rechazó la navegación a `localhost` en esta sesión (bloqueo de política del entorno, no del código), así que la verificación en vivo la corrió el usuario directamente, con `npm run dev` local. Resultado, confirmado por el usuario:

- Reload con coach existente — ok.
- Logout → login del mismo coach — ok, datos persistentes después del relogin.
- Sin datos cruzados entre coaches — ok.
- Cambio entre coaches (el caso A→B auditado en 8.1) — correcto.
- Recuperación de cuenta parcial real (`guilleg_tenis@hotmail.com`) — ok, detalle completo en la sección 5.

**Fase D queda validada** — implementación revisada, race condition cerrada, pruebas runtime pasadas. Lista para commit aislado (pendiente en el momento de escribir esto, ver instrucciones del usuario en la conversación para el mensaje exacto y el alcance del commit — no incluye `.claude/`).

## 9. Restricciones que rigen todo este trabajo (válidas para Fase D en adelante)

- No alterar reglas de negocio de clases/combos/pagos/asistencia/reprogramaciones/familias/agenda/finanzas — nunca, bajo ningún pretexto.
- Cambios incrementales, en fases pequeñas y aisladas — nunca un rewrite ni una fase que mezcle responsabilidades de otra.
- Cada fase: plan operativo por escrito → aprobación → implementación → build + lint + pruebas en navegador contra Supabase real (nunca solo simuladas cuando se puede evitar; nunca escritura real sobre datos de producción sin permiso explícito) → revisión del usuario → commit aislado recién ahí.
- **No commit ni push sin aprobación explícita del usuario en cada paso** — ni siquiera cuando el código ya está probado y funcionando.
- Claude nunca crea cuentas reales (ni de coach ni de alumno), nunca ejecuta SQL directamente (no tiene ni debe pedir `service_role`/acceso al dashboard), nunca hace `UPDATE`/`INSERT`/`DELETE` reales sobre datos de producción sin permiso explícito caso por caso — las pruebas contra Supabase real se hacen de solo lectura o interceptando la red en memoria del navegador.
