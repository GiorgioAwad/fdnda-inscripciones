# Inscripción del banco de datos de deportistas e inscripciones

FDNDA confirmó que todavía no cuenta con la inscripción de este banco y decidió atender el trámite después. La aplicación deja `PERSONAL_DATA_BANK_REGISTRATION_CODE` opcional por ahora; cuando se obtenga el código real se configurará en Production y aparecerá en la política de privacidad.

## Trámite que debe completar FDNDA

El representante autorizado debe seguir el [trámite de la ANPD](https://www.gob.pe/8060-inscribir-banco-de-datos-en-el-registro-nacional-de-proteccion-de-datos-personales). Según esa página, es virtual, gratuito y de aprobación automática. Se crea y valida una cuenta en SIPDP, se adjunta el documento que acredita la representación, se completa el formulario, se firma y se carga. Al terminar, la plataforma entrega constancia y código del banco. No compartir credenciales de SIPDP con el equipo técnico.

También se puede consultar el [registro público](https://www.gob.pe/9254-consultar-el-registro-nacional-de-proteccion-de-datos-personales) por nombre del titular o del banco para descartar una inscripción anterior. El representante o asesoría legal debe confirmar la denominación y el alcance del banco antes de presentar el formulario.

## Información técnica para completar el formulario

La [política de privacidad de la aplicación](../src/app/privacidad/page.tsx) describe el tratamiento previsto:

- Titular previsto: Federación Deportiva Nacional de Deportes Acuáticos. FDNDA debe validar su razón social, RUC y domicilio oficiales.
- Titulares de los datos: deportistas, incluidos menores de edad, y representantes o usuarios de clubes.
- Datos tratados: nombres, documento, fecha de nacimiento, sexo, disciplina, club, datos de contacto, afiliaciones, inscripciones y pagos. Validar con el área responsable si existen categorías adicionales en los Excel históricos antes de declararlas.
- Finalidades: verificar elegibilidad, administrar competencias y afiliaciones, cobrar cuotas, emitir constancias, prevenir fraude y atender obligaciones legales.
- Contacto para derechos de los titulares: `sportentries@fdnda.org`, proporcionado por FDNDA.
- Infraestructura prevista: aplicación en Vercel, base de datos Neon e integración de pagos Izipay. FDNDA debe revisar contratos, ubicación de almacenamiento y eventuales transferencias internacionales al completar el formulario.

El área responsable debe definir y validar plazos de conservación, medidas de seguridad, base legal, consentimientos y flujo de datos de menores. Este resumen sirve para preparar el formulario; la inscripción y la exactitud de la declaración corresponden a FDNDA.

Después del trámite, proporcionar al equipo técnico **solo el código del banco y la confirmación de que la constancia corresponde a este tratamiento**. El equipo configurará la variable en Vercel Production, verificará el preflight y publicará el código en la política de privacidad de la aplicación.