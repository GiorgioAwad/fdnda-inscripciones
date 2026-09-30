// Motivos por los que /inscripciones/nueva no pudo abrir una planilla. Viajan en
// la URL como clave (`?error=afiliacion`) y no como texto libre: así nadie puede
// armar un enlace que muestre un mensaje inventado dentro del portal.
export const OPEN_PLAN_ERRORS = {
  permiso: "Tu usuario de acceso no tiene permiso para crear planillas de este club.",
  competencia: "No encontramos esa competencia.",
  afiliacion:
    "Tu club no tiene afiliación vigente en las disciplinas de esa competencia.",
  "no-disponible":
    "Esa competencia ya no admite inscripciones de tu club: cerró su plazo, aún no tiene temporada o tu club no está afiliado en sus disciplinas.",
  "planilla-activa":
    "Ya hay una planilla activa de tu club para esa competencia. Búscala en «Tus planillas».",
  inesperado: "Vuelve a intentarlo en unos segundos.",
} as const

export type OpenPlanError = keyof typeof OPEN_PLAN_ERRORS

export function openPlanErrorMessage(key: string | undefined): string | null {
  if (!key || !Object.hasOwn(OPEN_PLAN_ERRORS, key)) return null
  return OPEN_PLAN_ERRORS[key as OpenPlanError]
}
