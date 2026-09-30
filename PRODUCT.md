# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Administradores de la FDNDA gestionan clubes, temporadas, padrón, afiliaciones, competencias y pagos.
- Coordinadores y delegados de clubes mantienen su nómina, pagan afiliaciones e inscriben deportistas en competencias dentro del alcance de sus disciplinas.

## Product Purpose

Centralizar el registro federativo de deportes acuáticos: mantener un padrón confiable, cobrar afiliaciones anuales por disciplina, validar elegibilidad e inscribir deportistas y equipos en competencias. El éxito exige que cada cobro y cada representación deportiva sean trazables al club y al momento en que ocurrieron.

## Operating Context

- Una sola temporada de afiliación puede estar vigente a la vez.
- La afiliación de un deportista se cobra por cada disciplina que practica.
- El club arma planillas y paga mediante órdenes; las inscripciones y órdenes pagadas son evidencia histórica y no cambian retroactivamente.
- La federación puede traspasar un deportista entre clubes. El traspaso es inmediato, libera sus afiliaciones vigentes con el club anterior y obliga al club destino a pagar afiliaciones nuevas.

## Capabilities and Constraints

- Solo un administrador puede ejecutar un traspaso.
- El deportista llega al club destino como «Sin afiliar» en todas sus disciplinas.
- Las afiliaciones e inscripciones pagadas del club anterior se conservan como historial.
- Una inscripción ya pagada mantiene el club original aunque la competencia aún no haya ocurrido.
- Un traspaso no puede ejecutarse mientras el deportista participe en una orden o planilla operativa pendiente.
- Los cambios de club deben pasar por el flujo de traspaso; la edición ordinaria y la importación no pueden omitirlo.
- El historial registra deportista, club de origen, club destino, administrador, fecha y motivo.

## Brand Commitments

El producto usa la identidad institucional FDNDA y su terminología federativa en español. Las nuevas superficies administrativas deben heredar los componentes, navegación, tipografía, colores y patrones de interacción existentes.

## Evidence on Hand

- Modelos y reglas de negocio: `prisma/schema.prisma` y `src/lib/affiliations.ts`.
- Panel administrativo y padrón: `src/app/admin`.
- Sistema visual existente: `src/app/globals.css` y `src/components/ui`.
- No se deben fabricar cifras, testimonios ni requisitos reglamentarios que no estén en el repositorio o confirmados por el usuario.

## Product Principles

- Preservar el historial financiero y deportivo; nunca reescribir hechos pagados.
- Hacer explícito el impacto antes de una operación administrativa irreversible.
- Evitar estados ambiguos entre padrón, afiliaciones, órdenes e inscripciones.
- Mantener trazabilidad suficiente para soporte y auditoría.
- Conservar una experiencia coherente entre el panel federativo y el portal de clubes.

## Accessibility & Inclusion

Las tareas administrativas deben poder completarse con teclado, estados y errores deben comunicarse también mediante texto, y la interfaz debe conservar los patrones de foco y contraste del sistema existente.

## Terminología de la interfaz

Un concepto, una palabra, en el portal y en el panel. Lo que no está aquí sigue el uso de la pantalla vecina.

- **competencia** (modelo `Event`), **prueba** (`EventModality`), **planilla** (`RegistrationPlan`; la sección se llama «Inscripciones»), **formación** (grupo inscrito en una prueba de equipo; en polo, **plantel**), **integrantes**.
- **registrar** = alta en el **padrón**; **afiliar** = derecho anual por temporada y disciplina; **inscribir** = en una competencia.
- **cuota de afiliación** (del club / por deportista) frente a **cuota de competencia por deportista** y **precio por formación**.
- **orden** es lo que se paga («Pagar orden»); la orden pagada es la **constancia** («Ver constancia»).
- Estados de afiliación: Vigente · Por vencer · Pendiente de pago · Vencida · Sin afiliar. De orden: Pendiente · Pagada · Pago rechazado · Expirada. De planilla: Borrador · Pago pendiente · Pagada. De competencia: Borrador · Inscripciones abiertas · Plazo vencido · Inscripciones cerradas. De temporada: Vigente · Próxima · Anterior.
- Club: Habilitado / Desactivado. Usuario: Acceso activo / Acceso bloqueado. Deportista: En padrón / De baja. Roles: coordinador del club, delegado de {disciplina}.
- Sexo de prueba: Damas · Varones · Mixto · Cualquier sexo. Sexo de deportista: Femenino · Masculino. Nombre de deportista: «Apellidos, Nombres».

## Voz de la interfaz

- Botones con verbo y objeto («Pagar orden», «Registrar club»); nada de «Guardar», «Continuar», «Ver» o «Gestionar» sueltos.
- Sin antetítulos sobre los títulos y sin descripciones que repitan el título.
- Los estados vacíos dicen qué falta y ofrecen la acción siguiente. Los errores dicen qué falló y cómo seguir.
- Las operaciones con consecuencias se confirman nombrando la acción, el objeto y el efecto.
- Un usuario nuevo recibe una guía de bienvenida una sola vez (`users.onboardedAt`); los primeros pasos de Inicio se calculan con datos reales y desaparecen al completarse.
