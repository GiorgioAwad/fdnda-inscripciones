# Incorporación futura de natación convencional

Decisión FDNDA (2026-09-28): preparar el plan técnico; no activar esta disciplina en la primera salida, no importar su padrón y no crear todavía la cuenta `aquatica-natacion`. Natación artística y polo acuático sí tienen delegados separados en Aquatica bajo un solo club.

## Diseño de datos y accesos

- Añadir `SWIMMING` como valor distinto de `ARTISTIC_SWIMMING` en `enum Discipline` de Prisma. La migración PostgreSQL debe contener solo `ALTER TYPE "Discipline" ADD VALUE 'SWIMMING'`; las operaciones que usen el valor nuevo irán en otra migración o despliegue.
- Mantener un único registro `Club` para Aquatica. Dar a `aquatica-natacion` `disciplineAccess = [SWIMMING]`; conservar `aquatica-artistica` y `aquatica-waterpolo` con sus alcances actuales. El coordinador `aquatica` seguirá viendo todas las disciplinas del club.
- Añadir natación convencional en `src/lib/disciplines.ts` usando el pictograma ya disponible `public/pictograms/swimming.png`, y en los alias de importación de `src/lib/excel.ts`. La plantilla deberá distinguir claramente `NATACION` de `NATACION ARTISTICA`.
- Extender `src/lib/event-presets.ts` sin inventar precios, categorías ni pruebas. Al principio, las competencias de natación no deberán abrirse hasta cargar reglas aprobadas; el padrón y las afiliaciones sí podrán configurarse por separado.
- Ajustar el seed de demostración para que no cree cuotas ni afiliaciones de natación cuando no exista un tarifario aprobado. El seed no se ejecuta sobre producción.

## Padrón e importación

- FDNDA entregará el archivo fuente de natación convencional y confirmará columnas, tipos de documento, fechas, club y disciplina. No existe tal archivo en el workspace actual.
- Preparar una importación de ensayo que compare documentos contra el padrón actual, fusione disciplinas de una misma persona y detenga conflictos de identidad o club. No crear un segundo registro de Aquatica ni duplicar deportistas por disciplina.
- Registrar cuántas filas se importarán, excluir solo las que FDNDA autorice y auditar en producción conteos por club y disciplina sin imprimir datos personales.

## Activación

1. Confirmar con FDNDA el alcance funcional, el padrón, tarifas anuales y, si habrá competencias, reglas de categorías, pruebas y cobro.
2. Implementar esquema, aplicación, plantilla de Excel y pruebas de aislamiento entre delegados.
3. Probar migración e importación en staging con una copia autorizada y verificar rollback/backup.
4. Aplicar migración en producción, importar el padrón aprobado y crear `aquatica-natacion` con contraseña temporal y cambio obligatorio.
5. Configurar tarifas y competencias solo cuando FDNDA las apruebe; verificar que la cuenta de natación no vea artística ni polo.

La primera salida de producción sigue limitada a clavados, natación artística y polo acuático.