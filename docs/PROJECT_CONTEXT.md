PROJECT_CONTEXT.md — IziCoach
1. PRODUCTO
IziCoach gestiona el ciclo operativo de academias y profesores de tenis:
	•	Alumnos y familias
	•	Profesores
	•	Clases, agenda y asistencia
	•	Individuales, combos y mensualidades
	•	Pagos e historial
	•	Pausas y reanudaciones
	•	Finanzas
2. ALUMNOS Y FAMILIAS
Student es una entidad central.
Un alumno puede:
	•	tomar clases individuales;
	•	utilizar combos/paquetes;
	•	pertenecer a grupos;
	•	pertenecer a una familia;
	•	tener clases, pagos y combos actuales/históricos.
Las familias agrupan alumnos principalmente para organización y cobros.
Un responsable de familia puede ser alumno o una persona externa.
Las relaciones y estructura de datos de Family/Student están documentadas en ARCHITECTURE.md.
3. MODELOS DE COBRO
Existen tres modelos principales:
Individual
	•	Cobro por clase.
Combo
	•	Paquete de cantidad determinada de clases.
	•	Debe mantener coherencia entre clases utilizadas, futuras, pausadas, fechas, pagos y renovaciones.
Mensual
	•	Cobro recurrente mensual.
	•	Puede incluir día de cobro, período de gracia y mensualidades.
	•	Su lógica debe permanecer separada de individual/combo.
4. ESTADOS DE CLASE
Código
Estado
CLS-01
Programada
CLS-02
Realizada
CLS-03
A Reprogramar
CLS-04
Reprogramada
CLS-05
Pausada
CLS-06
Ausente-Dada
CLS-07
Ausente-No Dada
CLS-08
Cancelada
Estos estados forman parte de la lógica funcional y pueden afectar Agenda, combos, pagos e historial.
5. AGENDA Y CALENDARIO
Agenda refleja las clases y sus estados.
Los cambios de:
	•	fechas;
	•	días;
	•	horarios;
	•	alumnos;
	•	pausas;
	•	reprogramaciones
deben mantenerse consistentes entre clases, Agenda, combos y pagos.
6. PAUSAS
Las clases pueden pausarse:
Sin fecha de reanudación
	•	Las clases futuras afectadas quedan pausadas.
Con fecha de reanudación
	•	Las clases pausadas originales permanecen como historial.
	•	Las clases restantes/reemplazos se generan según la fecha de reanudación y calendario correspondiente.
Debe funcionar tanto si la reanudación cae dentro como fuera del período original del combo.
7. REANUDACIÓN
Al reanudar:
	•	conservar las clases pausadas originales;
	•	continuar desde la fecha seleccionada;
	•	respetar los días del calendario;
	•	generar las clases necesarias;
	•	mantener consistente el combo;
	•	reflejar los cambios en Agenda y Pagos.
8. PAGOS
Pagos está relacionado con alumnos, clases, combos/mensualidades y fechas.
Los cambios que afecten clases o paquetes deben mantener coherencia con Actualizar Pagos y el historial correspondiente.
Los modelos individual, combo y mensual no deben interferir entre sí.
9. FINANZAS
Finanzas utiliza información proveniente de pagos para ingresos, egresos, resultados e historial.
Los cambios en la lógica de pagos pueden afectar Finanzas.
10. PRINCIPIOS FUNCIONALES
Historial Lo ocurrido debe permanecer registrado.
Consistencia Clases, Agenda, alumnos, combos y pagos deben permanecer sincronizados.
No duplicación No generar clases, combos o pagos duplicados.
No pérdida No eliminar información histórica para simplificar lógica.
Predictibilidad Una acción debe producir resultados coherentes en todas las pantallas relacionadas.
