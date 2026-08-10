// Pasos del flujo de inscripción: 1 competencia → 2 deportistas y pruebas →
// 3 revisión y pago.
//
// La columna RegistrationPlan.currentStep sigue guardando 1..4 del flujo
// anterior de cuatro pasos. Es solo una pista de reanudación, no un estado con
// significado propio, así que se mapea en lectura y escritura en vez de migrar
// la base: las planillas en borrador de los clubes reanudan igual.

export type StepNumber = 1 | 2 | 3

export function resumeStep(persisted: number, hasEvent: boolean): StepNumber {
  if (!hasEvent) return 1
  // El checkout y el pago escriben 4; ambos significan "revisión y pago".
  return persisted >= 4 ? 3 : 2
}

export function persistedStepFor(step: StepNumber): number {
  return step === 3 ? 4 : step
}
