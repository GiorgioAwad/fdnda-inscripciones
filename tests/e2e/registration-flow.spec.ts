import { expect, test, type Page } from "@playwright/test"

// Flujo de dos pasos: primero la competencia, después una sola pantalla donde se
// agregan deportistas y se marcan sus pruebas. La revisión y el pago cierran.

const SAVED = /Todos los cambios est.n guardados.*revisi.n [1-9]\d*/

async function login(page: Page, username: string, password: string) {
  await page.goto("/login")
  await page.getByLabel(/^Usuario/).fill(username)
  await page.getByLabel(/^Contrase/).fill(password)
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/inicio/)
}

async function expectSaved(page: Page) {
  await expect(page.locator('[role="status"]').first()).toContainText(SAVED)
}

async function chooseCompetition(page: Page, eventName = "Competencia E2E") {
  const heading = page.getByRole("heading", { name: eventName, exact: true })
  await heading
    .locator("xpath=ancestor::div[.//button[normalize-space()='Seleccionar']][1]")
    .getByRole("button", { name: "Seleccionar" })
    .click()
  // selectEvent recarga la página; al volver, el plan ya tiene competencia.
  await expect(page.getByRole("heading", { name: /Arma tu planilla/ })).toBeVisible()
}

async function addAthlete(page: Page, document: string) {
  await page.getByPlaceholder("Nombre o documento").fill(document)
  await page.getByRole("button", { name: "Buscar" }).click()
  await page
    .getByRole("listitem")
    .filter({ hasText: document })
    .getByRole("button", { name: /Agregar/ })
    .click()
  await expectSaved(page)
}

async function checkModality(page: Page, modalityName: string) {
  await page.getByRole("checkbox", { name: new RegExp(modalityName) }).check()
  await expectSaved(page)
}

async function goToReview(page: Page) {
  await page.getByRole("button", { name: /Revisar y pagar/ }).click()
  await expect(page.getByRole("heading", { name: /Revisión y pago/ })).toBeVisible()
}

test("obliga a reemplazar una credencial temporal antes de entrar", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "El control de credenciales se valida una vez")
  await page.goto("/login")
  await page.getByLabel(/^Usuario/).fill("e2e-temporary")
  await page.getByLabel(/^Contrase/).fill("Temporary123!")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/cambiar-clave/)

  await page.getByLabel(/temporal o actual/).fill("Temporary123!")
  await page.getByLabel(/^Nueva contrase/).fill("Permanent456!")
  await page.getByLabel(/Repite la nueva/).fill("Permanent456!")
  await page.getByRole("button", { name: /Cambiar contrase/ }).click()
  await expect(page).toHaveURL(/\/login\?passwordChanged=1/)
  await expect(page.getByText(/Contrase.a actualizada/)).toBeVisible()

  await page.getByLabel(/^Usuario/).fill("e2e-temporary")
  await page.getByLabel(/^Contrase/).fill("Permanent456!")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/inicio/)
})

test("admite y marca el ascenso explícito en natación artística", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "La categoría ascendente se valida una vez")
  await login(page, "e2e-upgrade", "E2eUpgrade123!")
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page, "Artística E2E Ascenso")
  await addAthlete(page, "88000005")
  await checkModality(page, "Solo E2E ascenso")
  await goToReview(page)

  await expect(page.getByText(/Planilla lista para pagar/)).toBeVisible()
  await expect(
    page.getByText(/compite en la categor.a inmediata superior en Solo E2E ascenso/)
  ).toBeVisible()

  const summaryPromise = page.waitForEvent("popup")
  await page.getByRole("button", { name: /Resumen imprimible/ }).click()
  const summary = await summaryPromise
  await expect(summary).toHaveURL(/\/inscripciones\/[^/]+\/resumen\?revision=\d+/)
  await expect(
    summary.getByText(/compite en la categor.a inmediata superior en Solo E2E ascenso/)
  ).toBeVisible()
})

test("flujo completo, recarga, pago y planilla suplementaria", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "El flujo transaccional se ejecuta una vez en escritorio")
  await login(page, "e2e-club", "E2eClub123!")
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page)
  await addAthlete(page, "88000001")
  await checkModality(page, "Trampolin E2E")

  // El borrador sobrevive a una recarga con la prueba ya marcada.
  await page.reload()
  await expect(
    page.getByRole("checkbox", { name: /Trampolin E2E/ })
  ).toBeChecked()

  await goToReview(page)
  await expect(page.getByText("Planilla lista para pagar")).toBeVisible()
  await page.getByRole("button", { name: "Crear orden y pagar" }).click()
  await expect(page).toHaveURL(/\/pago\//)
  await page.getByRole("button", { name: /Pagar \(simulado\)/ }).click()
  await expect(page.getByText(/Pago confirmado/)).toBeVisible()
  // El comprobante detallado muestra al deportista con su documento.
  await expect(page.getByText(/88000001/)).toBeVisible()

  // Planilla suplementaria: la inscripción ya pagada aparece bloqueada.
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page)
  await addAthlete(page, "88000002")
  await checkModality(page, "Trampolin E2E")
  await goToReview(page)
  await expect(page.getByText("Planilla lista para pagar")).toBeVisible()
  await expect(page.getByText(/Inscripciones previas de esta competencia/)).toBeVisible()
})

test("bloquea el pago cuando falta afiliacion del deportista", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "La validacion funcional se ejecuta una vez")
  await login(page, "e2e-missing", "E2eMissing123!")
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page)
  await addAthlete(page, "88000003")
  await checkModality(page, "Trampolin E2E")
  await goToReview(page)
  await expect(page.getByText(/no tiene una afiliaci.n de Clavados/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Crear orden y pagar" })).toBeDisabled()
})

test("conserva una formación de equipo incompleta y bloquea el checkout", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "El borrador persistente se valida una vez")
  await login(page, "e2e-draft", "E2eDraft123!")
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page)
  await addAthlete(page, "88000006")

  await page.getByRole("button", { name: /Nueva formaci.n/ }).click()
  await expectSaved(page)
  await page.getByRole("button", { name: /Cerrar edici.n/ }).click()

  await page.reload()
  await expect(page.getByText("Formación incompleta", { exact: true })).toBeVisible()
  await goToReview(page)
  await expect(page.getByText(/Esta prueba requiere 2 deportista/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Crear orden y pagar" })).toBeDisabled()
})

test("un fallo de red no sobrescribe el borrador", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "La recuperacion de red se ejecuta una vez")
  await login(page, "e2e-network", "E2eNetwork123!")
  await page.goto("/inscripciones/nueva")
  await chooseCompetition(page)
  await page.getByPlaceholder("Nombre o documento").fill("88000004")
  await page.getByRole("button", { name: "Buscar" }).click()

  await page.route(
    "**/*",
    async (route) => {
      const request = route.request()
      if (request.method() === "POST" && request.headers()["next-action"]) {
        await route.abort("failed")
        return
      }
      await route.continue()
    },
    { times: 1 }
  )
  await page
    .getByRole("listitem")
    .filter({ hasText: "88000004" })
    .getByRole("button", { name: /Agregar/ })
    .click()
  await expect(page.getByRole("button", { name: "Recargar" })).toBeVisible()
  await page.unroute("**/*")
  await page.reload()
  await page.getByPlaceholder("Nombre o documento").fill("88000004")
  await page.getByRole("button", { name: "Buscar" }).click()
  // El deportista sigue fuera de la planilla: el fallo no dejó basura.
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "88000004" })
      .getByRole("button", { name: /Agregar/ })
  ).toBeVisible()
})

test("navegacion movil y foco de teclado", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Este escenario valida el proyecto movil")
  await login(page, "e2e-club", "E2eClub123!")
  const menu = page.getByRole("button", { name: /Abrir men.* del club/ })
  await menu.focus()
  await expect(menu).toBeFocused()
  await menu.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("link", { name: /^Inscripciones$/ }).click()
  await expect(page.getByRole("heading", { name: /^Inscripciones$/ })).toBeVisible()
})
