/**
 * End-to-end acceptance test for the Route 53 clone.
 * Requires the backend on :8000 with a FRESHLY SEEDED database and the frontend on :3000.
 *   cd e2e && npm install && npx playwright install chromium && npm test
 */
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || `${__dirname}/screenshots`;
require("fs").mkdirSync(SHOTS, { recursive: true });

let failures = 0;
let PAGE;
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  PAGE = page;
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });

  // --- Auth: protected route redirects to login
  await page.goto(`${BASE}/hosted-zones`);
  await page.waitForURL(/\/login/);
  check(page.url().includes("/login?next=%2Fhosted-zones"), "Protected route redirects to login with next param");
  await page.getByRole("heading", { name: "Sign in" }).filter({ visible: true }).first().waitFor();
  await shot("01-login");

  // Validation + bad credentials
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check(await page.getByText("Account ID is required.").isVisible(), "Login form shows required-field errors");
  await page.getByLabel("Account ID (12 digits) or account alias").fill("123456789012");
  await page.getByLabel("IAM username").fill("demo");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Your authentication information is incorrect").filter({ visible: true }).first().waitFor();
  check(true, "Wrong password shows error");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/hosted-zones$/);
  await page.getByRole("heading", { name: /Hosted zones/ }).filter({ visible: true }).first().waitFor();
  await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
  check(true, "Login succeeds and lands on hosted zones");
  await shot("02-hosted-zones");

  // Session persistence
  await page.reload();
  await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
  check(page.url().endsWith("/hosted-zones"), "Session persists after refresh");

  // --- Hosted zones: search
  const filter = page.getByPlaceholder("Filter hosted zones by name, ID or description");
  await filter.fill("mycompany");
  await page.getByText("2 matches").filter({ visible: true }).first().waitFor();
  check(await page.getByRole("link", { name: "example.com", exact: true }).count() === 0, "Zone search filters list");
  await filter.fill("zzzz-nothing");
  await page.getByText("No matches").filter({ visible: true }).first().waitFor();
  check(true, "Zone search shows no-match empty state");
  await shot("03-zones-nomatch");
  await page.getByRole("button", { name: "Clear filter" }).click();
  await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();

  // Type filter
  await page.getByRole("button", { name: /Filter by hosted zone type/ }).click();
  await page.getByRole("option", { name: "Private" }).click();
  await page.getByRole("link", { name: "example.com", exact: true }).waitFor({ state: "detached" });
  check(await page.getByRole("link", { name: "internal.mycompany.com" }).filter({ visible: true }).count() === 1, "Zone type filter works");
  await page.getByRole("button", { name: /Filter by hosted zone type/ }).click();
  await page.getByRole("option", { name: "All hosted zone types" }).click();

  // --- Create hosted zone (validation then success)
  await page.getByRole("link", { name: "Create hosted zone" }).first().click();
  await page.waitForURL(/\/hosted-zones\/create/);
  await page.getByRole("button", { name: "Create hosted zone" }).click();
  check(await page.getByText("Domain name is required.").isVisible(), "Create zone validates required name");
  await page.getByLabel("Domain name").fill("e2e-test.dev");
  await page.getByPlaceholder("The hosted zone is used for...").fill("Created by E2E");
  await shot("04-create-zone");
  await page.getByRole("button", { name: "Create hosted zone" }).click();
  await page.waitForURL(/\/hosted-zones\/Z[A-Z0-9]+$/);
  await page.getByText("Hosted zone e2e-test.dev was successfully created.").filter({ visible: true }).first().waitFor();
  check(true, "Create zone succeeds with flash notification and navigates to detail");
  const zoneUrl = page.url();
  await page.getByRole("tab", { name: "Records (2)" }).filter({ visible: true }).first().waitFor();
  check(true, "New zone has default NS + SOA records");

  // Duplicate zone error
  await page.goto(`${BASE}/hosted-zones/create`);
  await page.getByLabel("Domain name").fill("e2e-test.dev");
  await page.getByRole("button", { name: "Create hosted zone" }).click();
  await page.getByText(/already exists/).filter({ visible: true }).first().waitFor();
  check(true, "Duplicate zone shows API error in form");

  // --- Edit hosted zone (modal)
  await page.goto(zoneUrl);
  await page.getByRole("button", { name: "Edit hosted zone" }).first().click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox").last().fill("Updated description");
  await shot("05-edit-zone-modal");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Hosted zone e2e-test.dev was successfully updated.").filter({ visible: true }).first().waitFor();
  await page.getByText("Hosted zone details").click();
  await page.getByText("Updated description").filter({ visible: true }).first().waitFor();
  check(true, "Edit zone description persists");

  // --- Records: create each type
  const types = [
    ["www", "A", "192.0.2.10\n192.0.2.11"],
    ["v6", "AAAA", "2001:db8::1"],
    ["blog", "CNAME", "blog.example.net"],
    ["", "TXT", "hello world"],
    ["", "MX", "10 mail.e2e-test.dev"],
    ["sub", "NS", "ns1.example.net"],
    ["ptr", "PTR", "host.example.net"],
    ["_sip._tcp", "SRV", "1 10 5060 sip.e2e-test.dev"],
    ["", "CAA", '0 issue "amazon.com"'],
  ];
  for (const [name, type, value] of types) {
    await page.getByRole("link", { name: "Create record" }).first().click();
    await page.waitForURL(/records\/create/);
    await page.getByRole("textbox", { name: "Record name" }).fill(name);
    await page.getByRole("button", { name: /Record type/ }).click();
    await page.getByRole("option", { name: new RegExp(`^${type} `) }).click();
    await page.getByRole("textbox", { name: "Value", exact: true }).fill(value);
    if (type === "MX") await shot("06-create-record-mx");
    await page.getByRole("button", { name: "Create records" }).click();
    await page.waitForURL(zoneUrl);
    await page.getByText(new RegExp(`\\(${type}\\) was successfully created`)).filter({ visible: true }).first().waitFor();
  }
  await page.getByRole("tab", { name: "Records (11)" }).filter({ visible: true }).first().waitFor();
  check(true, "Created records of all 9 types");
  await shot("07-records");

  // Client-side validation on record form
  await page.getByRole("link", { name: "Create record" }).first().click();
  await page.waitForURL(/records\/create/);
  await page.getByRole("textbox", { name: "Record name" }).fill("bad");
  await page.getByRole("textbox", { name: "Value", exact: true }).fill("999.1.1.1");
  await page.getByRole("button", { name: "Create records" }).click();
  check(await page.getByText(/not a valid IPv4 address/).isVisible(), "Record form validates IPv4 client-side");
  // Server-side conflict (duplicate A at www)
  await page.getByRole("textbox", { name: "Record name" }).fill("www");
  await page.getByRole("textbox", { name: "Value", exact: true }).fill("192.0.2.99");
  await page.getByRole("button", { name: "Create records" }).click();
  await page.getByText(/already exists/).filter({ visible: true }).first().waitFor();
  check(true, "Duplicate record shows server error");
  await shot("08-record-error");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(zoneUrl);

  // --- Records search + type filter
  const rfilter = page.getByPlaceholder("Filter records by property or value");
  await rfilter.fill("192.0.2.11");
  await page.getByText("1 match", { exact: true }).filter({ visible: true }).first().waitFor();
  check(true, "Record search by value");
  await rfilter.fill("");
  await page.getByRole("button", { name: /Filter by record type/ }).click();
  await page.getByRole("option", { name: "MX", exact: true }).click();
  await page.locator("h2", { hasText: /^Records\s*\(1\)$/ }).first().waitFor();
  check(true, "Record type filter");
  await page.getByRole("button", { name: /Filter by record type/ }).click();
  await page.getByRole("option", { name: "Type: All" }).click();

  // --- Select record → split panel → edit
  await rfilter.fill("www.e2e");
  await page.getByText("1 match", { exact: true }).filter({ visible: true }).first().waitFor();
  await page.getByRole("checkbox", { name: "www.e2e-test.dev A" }).check();
  await page.getByText("Record details").filter({ visible: true }).first().waitFor();
  await shot("09-split-panel");
  check(true, "Selecting a record opens Record details split panel");
  await page.getByRole("button", { name: "Edit record" }).first().click();
  await page.waitForURL(/\/edit(\?|$)/);
  await page.getByRole("textbox", { name: "Value", exact: true }).fill("203.0.113.7");
  await page.getByRole("button", { name: "1h" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  // Save returns to the zone page with the active records filter kept in the URL.
  await page.waitForURL((u) => u.href.startsWith(zoneUrl) && u.searchParams.get("search") === "www.e2e");
  await page.getByText("Record www.e2e-test.dev (A) was successfully updated.").filter({ visible: true }).first().waitFor();
  await rfilter.fill("203.0.113.7");
  await page.getByText("1 match", { exact: true }).filter({ visible: true }).first().waitFor();
  check(await page.getByRole("cell", { name: "3600" }).count() === 1, "Edited record value + TTL saved");
  await rfilter.fill("");

  // --- Delete zone blocked while records exist
  await page.getByRole("button", { name: "Delete zone" }).click();
  await page.getByText("This hosted zone contains records").filter({ visible: true }).first().waitFor();
  check(await page.getByRole("dialog").getByRole("button", { name: "Delete" }).isDisabled(), "Zone delete blocked while non-default records exist");
  await shot("10-delete-zone-blocked");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // --- Bulk delete all records (select all on page)
  await page.locator("h2", { hasText: /^Records\s*\(11\)$/ }).first().waitFor();
  await page.getByRole("checkbox", { name: "Select all records on this page" }).check();
  await page.getByRole("button", { name: "Delete record" }).click();
  await page.getByText("Some records can't be deleted").filter({ visible: true }).first().waitFor();
  await shot("11-bulk-delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByText("9 records were successfully deleted.").filter({ visible: true }).first().waitFor();
  await page.getByRole("tab", { name: "Records (2)" }).filter({ visible: true }).first().waitFor();
  check(true, "Bulk delete leaves only default records");

  // --- Import zone file (bonus)
  await page.getByRole("button", { name: "Import zone file" }).click();
  await page.getByPlaceholder(/\$ORIGIN/).fill("$ORIGIN e2e-test.dev.\n$TTL 300\napi IN A 192.0.2.50\n@ IN MX 5 mx.e2e-test.dev.\n");
  await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();
  await page.getByText("Created 2 record sets, skipped 0.").filter({ visible: true }).first().waitFor();
  check(true, "Import BIND zone file");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: "Records (4)" }).filter({ visible: true }).first().waitFor();

  // Single delete via modal
  await rfilter.fill("api.e2e");
  await page.getByText("1 match", { exact: true }).filter({ visible: true }).first().waitFor();
  await page.getByRole("checkbox", { name: "api.e2e-test.dev A" }).check();
  await page.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByText("Record api.e2e-test.dev (A) was successfully deleted.").filter({ visible: true }).first().waitFor();
  await rfilter.fill("");
  await page.getByRole("checkbox", { name: /e2e-test.dev MX/ }).check();
  await page.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("tab", { name: "Records (2)" }).filter({ visible: true }).first().waitFor();
  check(true, "Single record delete");

  // --- Delete zone (type-to-confirm)
  await page.getByRole("button", { name: "Delete zone" }).click();
  const del = page.getByRole("dialog");
  check(await del.getByRole("button", { name: "Delete" }).isDisabled(), "Delete disabled until confirmation typed");
  await del.getByLabel("Confirm deletion").fill("delete");
  await del.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(/\/hosted-zones$/);
  await page.getByText("Hosted zone e2e-test.dev was successfully deleted.").filter({ visible: true }).first().waitFor();
  await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
  check(await page.getByRole("link", { name: "e2e-test.dev" }).count() === 0, "Zone deleted and removed from list");

  // --- Pagination on records (example.com has 17 records; set page size 10 via preferences)
  await page.getByRole("link", { name: "example.com", exact: true }).click();
  await page.getByRole("tab", { name: "Records (17)" }).filter({ visible: true }).first().waitFor();
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByRole("radio", { name: "10 records" }).check();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Page 2 of all pages" }).filter({ visible: true }).first().waitFor();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Page 2 of all pages", pressed: true }).filter({ visible: true }).first().waitFor().catch(() => {});
  const rows = await page.locator("table tbody tr").count();
  check(rows === 7, `Records pagination page 2 shows 7 rows (got ${rows})`);
  await shot("12-pagination");

  // --- Not found zone
  await page.goto(`${BASE}/hosted-zones/ZDOESNOTEXIST`);
  await page.getByText("Hosted zone not found").filter({ visible: true }).first().waitFor();
  check(true, "Unknown zone shows friendly not-found error");

  // --- Coming soon pages via nav
  await page.goto(`${BASE}/hosted-zones`);
  await page.getByRole("link", { name: "Health checks" }).click();
  await page.getByText("Coming soon").filter({ visible: true }).first().waitFor();
  check(page.url().endsWith("/health-checks"), "Mocked section shows Coming soon");
  await shot("13-coming-soon");
  for (const p of ["dashboard", "traffic-policies", "profiles", "resolver/vpcs"]) {
    await page.goto(`${BASE}/${p}`);
    await page.getByText("Coming soon").filter({ visible: true }).first().waitFor();
  }
  check(true, "Dashboard, Traffic policies, Profiles, Resolver all render Coming soon");

  // --- Console search (top bar, Alt+S)
  await page.goto(`${BASE}/dashboard`);
  await page.getByText("Coming soon").filter({ visible: true }).first().waitFor();
  await page.keyboard.press("Alt+s");
  await page.keyboard.type("example.o");
  await page.getByRole("option", { name: /example\.org/ }).first().waitFor();
  check(true, "Console search suggests matching hosted zones");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/hosted-zones\?search=example\.o/);
  await page.getByRole("link", { name: "example.org", exact: true }).filter({ visible: true }).first().waitFor();
  check((await page.getByRole("link", { name: "example.com", exact: true }).count()) === 0, "Console search Enter filters the hosted zone list");

  // --- Create several records in one batch ("Add another record")
  await page.getByRole("link", { name: "example.org", exact: true }).click();
  await page.waitForURL(/\/hosted-zones\/Z[^/]+$/);
  const orgUrl = page.url();
  await page.getByRole("link", { name: "Create record" }).filter({ visible: true }).first().click();
  await page.waitForURL(/records\/create/);
  const names = () => page.getByRole("textbox", { name: "Record name", exact: true });
  const values = () => page.getByRole("textbox", { name: "Value", exact: true });
  await names().nth(0).fill("batch1");
  await values().nth(0).fill("192.0.2.71");
  await page.getByRole("button", { name: "Add another record" }).click();
  await names().nth(1).fill("www"); // conflicts with the existing www CNAME → whole batch rejected
  await values().nth(1).fill("192.0.2.72");
  await page.getByRole("button", { name: "Create records" }).click();
  await page.getByText(/^Record 2: .*CNAME/).filter({ visible: true }).first().waitFor();
  check(true, "Batch create reports which record failed");
  await names().nth(1).fill("batch2");
  await page.getByRole("button", { name: "Create records" }).click();
  await page.getByText("2 records were successfully created in example.org.").filter({ visible: true }).first().waitFor();
  await page.waitForURL(orgUrl);
  await page.getByPlaceholder("Filter records by property or value").filter({ visible: true }).first().fill("batch");
  await page.getByText("2 matches").filter({ visible: true }).first().waitFor();
  check(true, "Batch create adds all records (and the rejected attempt added none)");
  await shot("16-batch-created");

  // --- Test record (DNS response simulator)
  await page.goto(`${BASE}/hosted-zones?search=example.com`);
  await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/hosted-zones\/Z[^/?]+$/);
  await page.getByRole("link", { name: "Test record" }).click();
  await page.waitForURL(/\/test-record$/);
  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link", { name: "example.com", exact: true }).waitFor();
  check(true, "Test record breadcrumbs link back to the zone");
  await page.getByRole("textbox", { name: "Record name" }).fill("www");
  await page.getByRole("button", { name: "Get response" }).click();
  await page.getByText("Response returned by Route 53").filter({ visible: true }).first().waitFor();
  await page.getByText("No error (NOERROR)").filter({ visible: true }).first().waitFor();
  check(
    (await page.getByText("www.example.com A", { exact: true }).count()) > 0 && (await page.getByText(/192\.0\.2\.10/).count()) > 0,
    "Test record follows the www CNAME to the apex A values",
  );
  await shot("17-test-record");
  await page.getByRole("textbox", { name: "Record name" }).fill("does-not-exist");
  await page.getByRole("button", { name: "Get response" }).click();
  await page.getByText("Non-existent domain (NXDOMAIN)").filter({ visible: true }).first().waitFor();
  check(await page.getByText("Authority section").filter({ visible: true }).count() > 0, "Test record reports NXDOMAIN with the SOA authority");

  // --- Concurrent edit protection (optimistic locking)
  {
    const API = process.env.API_URL || "http://localhost:8000";
    const token = await page.evaluate(() => localStorage.getItem("r53.session"));
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const zones = await (await fetch(`${API}/api/hosted-zones?search=example.org`, { headers: H })).json();
    const org = zones.items.find((z) => z.name === "example.org");
    const recs = await (await fetch(`${API}/api/hosted-zones/${org.id}/records?search=docs`, { headers: H })).json();
    const docs = recs.items[0];
    await page.goto(`${BASE}/hosted-zones/${org.id}/records/${docs.id}/edit`);
    const value = page.getByRole("textbox", { name: "Value", exact: true });
    await value.waitFor();
    // Someone else saves the record while the form is open.
    await fetch(`${API}/api/hosted-zones/${org.id}/records/${docs.id}`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ name: "docs", type: "CNAME", ttl: 300, values: ["changed-elsewhere.example.net"] }),
    });
    await value.fill("mine.example.net");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("This record was changed after you opened it.").filter({ visible: true }).first().waitFor();
    check(page.url().endsWith("/edit"), "Saving a record changed by someone else shows a conflict and stays on the form");
    await shot("18-edit-conflict");
    await page.getByRole("button", { name: "Reload latest" }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll("textarea")].some((t) => t.value === "changed-elsewhere.example.net"),
    );
    check(true, "Reload latest loads the other user's values into the form");
    await value.fill("mine.example.net");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Record docs.example.org (CNAME) was successfully updated.").filter({ visible: true }).first().waitFor();
    check(true, "Saving after reloading succeeds");
  }

  // --- Filters and pagination live in the URL
  {
    const zonesFilter = () => page.getByPlaceholder("Filter hosted zones by name, ID or description").filter({ visible: true }).first();
    await page.goto(`${BASE}/hosted-zones`);
    await zonesFilter().fill("company");
    await page.getByRole("button", { name: /All hosted zone types/ }).filter({ visible: true }).first().click();
    await page.getByRole("option", { name: "Private" }).click();
    await page.waitForURL((u) => u.searchParams.get("search") === "company" && u.searchParams.get("type") === "private");
    await page.reload();
    await page.getByRole("link", { name: "internal.mycompany.com" }).filter({ visible: true }).first().waitFor();
    check(
      (await zonesFilter().inputValue()) === "company" && (await page.getByRole("link", { name: "mycompany.com", exact: true }).count()) === 0,
      "Hosted zone search and type filter survive a refresh (URL state)",
    );
    // Back button restores the filtered list.
    await page.getByRole("link", { name: "internal.mycompany.com" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/hosted-zones\/Z/);
    await page.goBack();
    await page.waitForURL((u) => u.pathname === "/hosted-zones" && u.searchParams.get("type") === "private");
    await page.getByRole("link", { name: "internal.mycompany.com" }).filter({ visible: true }).first().waitFor();
    check((await zonesFilter().inputValue()) === "company", "Browser back returns to the filtered hosted zone list");
    // Invalid params fall back to defaults.
    await page.goto(`${BASE}/hosted-zones?page=abc&pageSize=7&type=bogus`);
    await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
    await page.waitForURL((u) => u.pathname === "/hosted-zones" && u.search === "");
    check(true, "Invalid URL params fall back to the defaults");

    // Shared link to a records page.
    const zonesRes = await page.evaluate(async () => {
      const r = await fetch("http://localhost:8000/api/hosted-zones?search=example.com", {
        headers: { Authorization: `Bearer ${localStorage.getItem("r53.session")}` },
      });
      return r.json();
    });
    const com = zonesRes.items.find((z) => z.name === "example.com");
    await page.goto(`${BASE}/hosted-zones/${com.id}?pageSize=10&page=2`);
    await page.getByRole("button", { name: "Page 2 of all pages" }).filter({ visible: true }).first().waitFor();
    const current = await page.getByRole("button", { name: "Page 2 of all pages" }).filter({ visible: true }).first().getAttribute("aria-current");
    const rows2 = await page.getByRole("row").filter({ has: page.getByRole("cell") }).filter({ visible: true }).count();
    check(current === "true" && rows2 === 7, `Shared records link opens page 2 of 10 (rows: ${rows2})`);

    // Records filter → Edit → Cancel and Create → Cancel return to the same view.
    const recFilter = () => page.getByPlaceholder("Filter records by property or value").filter({ visible: true }).first();
    await page.goto(`${BASE}/hosted-zones/${com.id}`);
    await recFilter().fill("mail");
    await page.getByRole("button", { name: /Type: All/ }).filter({ visible: true }).first().click();
    await page.getByRole("option", { name: "A", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("search") === "mail" && u.searchParams.get("type") === "A");
    const filteredUrl = page.url();
    await page.getByRole("checkbox", { name: "mail1.example.com A", exact: true }).check();
    await page.getByRole("button", { name: "Edit record" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/edit\?back=/);
    await page.getByRole("button", { name: "Cancel" }).filter({ visible: true }).first().click();
    await page.waitForURL(filteredUrl);
    await page.getByRole("checkbox", { name: "mail2.example.com A", exact: true }).waitFor();
    check((await recFilter().inputValue()) === "mail", "Cancel on Edit record returns to the same filtered records view");
    await page.getByRole("link", { name: "Create record" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/records\/create\?back=/);
    await page.getByRole("button", { name: "Cancel" }).filter({ visible: true }).first().click();
    await page.waitForURL(filteredUrl);
    check((await recFilter().inputValue()) === "mail", "Cancel on Create record returns to the same filtered records view");
    await page.getByRole("checkbox", { name: "mail1.example.com A", exact: true }).check();
    await page.getByRole("button", { name: "Edit record" }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/edit\?back=/);
    await page.getByRole("spinbutton", { name: "TTL" }).fill("1800");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(filteredUrl);
    await page.getByText("Record mail1.example.com (A) was successfully updated.").filter({ visible: true }).first().waitFor();
    check((await recFilter().inputValue()) === "mail", "Save on Edit record returns to the same filtered records view");
  }

  // --- Change status (PENDING → INSYNC) and Change history
  {
    const zonesRes = await page.evaluate(async () => {
      const r = await fetch("http://localhost:8000/api/hosted-zones?search=shop-demo", {
        headers: { Authorization: `Bearer ${localStorage.getItem("r53.session")}` },
      });
      return r.json();
    });
    const shop = zonesRes.items[0];
    await page.goto(`${BASE}/hosted-zones/${shop.id}/records/create`);
    await page.getByRole("textbox", { name: "Record name", exact: true }).fill("history1");
    await page.getByRole("textbox", { name: "Value", exact: true }).fill("192.0.2.123");
    await page.getByRole("button", { name: "Create records" }).click();
    await page.getByText("Record history1.shop-demo.net (A) was successfully created.").filter({ visible: true }).first().waitFor();
    check(await page.getByText("PENDING", { exact: true }).filter({ visible: true }).count() > 0, "Change flash shows Status: PENDING");
    await shot("19-change-pending");
    // Default propagation is 10 s; a pending flash must not auto-dismiss (8 s) before it turns INSYNC.
    await page.getByText("INSYNC", { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    check(
      await page.getByText("Record history1.shop-demo.net (A) was successfully created.").filter({ visible: true }).count() > 0,
      "Change flash stays until it reports INSYNC",
    );

    await page.getByRole("tab", { name: "Change history" }).click();
    const historyRow = page.getByRole("row").filter({ hasText: "history1.shop-demo.net A" });
    await historyRow.first().waitFor();
    const rowText = await historyRow.first().innerText();
    check(/Create/.test(rowText) && /demo/.test(rowText) && /INSYNC/.test(rowText), "Change history lists the change with action, user and status");
    await shot("20-change-history");

    await page.getByRole("tab", { name: /^Records/ }).click();
    await page.getByRole("checkbox", { name: "history1.shop-demo.net A", exact: true }).check();
    await page.getByRole("button", { name: "Delete record" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await page.getByText("Record history1.shop-demo.net (A) was successfully deleted.").filter({ visible: true }).first().waitFor();
    await page.getByRole("tab", { name: "Change history" }).click();
    await page.getByRole("row").filter({ hasText: "history1.shop-demo.net A" }).filter({ hasText: "Delete" }).first().waitFor();
    check(true, "Deleting a record adds a Delete entry to Change history");
  }

  // --- Keyboard shortcuts
  {
    const dialog = page.getByRole("dialog").filter({ hasText: "Keyboard shortcuts" });
    await page.goto(`${BASE}/hosted-zones`);
    await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
    await page.keyboard.press("?");
    await dialog.filter({ visible: true }).first().waitFor();
    check(await dialog.getByText("Go to Hosted zones").isVisible(), '"?" opens the keyboard shortcuts dialog');
    await shot("22-keyboard-shortcuts");
    await page.keyboard.press("Escape");
    await dialog.filter({ visible: true }).first().waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await dialog.filter({ visible: true }).first().waitFor();
    check(true, "Settings menu opens the keyboard shortcuts dialog");
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.filter({ visible: true }).first().waitFor({ state: "hidden" });

    // Typing "c" in the filter must not trigger the shortcut.
    const zoneFilter = page.getByPlaceholder("Filter hosted zones by name, ID or description").filter({ visible: true }).first();
    await zoneFilter.click();
    await page.keyboard.type("c");
    await page.waitForTimeout(600);
    check(new URL(page.url()).pathname === "/hosted-zones" && (await zoneFilter.inputValue()) === "c", 'Typing "c" in the filter does not navigate');
    await zoneFilter.fill("");
    await page.locator("body").click({ position: { x: 5, y: 300 } });

    await page.keyboard.press("c");
    await page.waitForURL(/\/hosted-zones\/create$/);
    check(true, '"c" on the hosted zones page opens Create hosted zone');
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await page.waitForURL(/\/hosted-zones$/);
    check(true, '"g h" goes to Hosted zones');

    await page.getByRole("radio", { name: "example.org" }).check();
    const edit = page.getByRole("button", { name: "Edit", exact: true }).filter({ visible: true }).first();
    const enabledBefore = await edit.isEnabled();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(enabledBefore && !(await page.getByRole("radio", { name: "example.org" }).isChecked()) && !(await edit.isEnabled()), '"Escape" clears the selection');
  }

  // --- Dark mode
  await page.goto(`${BASE}/hosted-zones`);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: /Visual mode/ }).click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.body.classList.contains("awsui-dark-mode")), "Dark mode toggles");
  await shot("14-dark-mode");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("menuitem", { name: /Visual mode/ }).click();

  // --- Logout
  await page.getByRole("button", { name: /demo @/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.getByText("You have signed out.").filter({ visible: true }).first().waitFor();
  await page.goto(`${BASE}/hosted-zones`);
  await page.waitForURL(/\/login/);
  check(true, "Logout clears session; protected route redirects again");

  // --- Remember this account
  await page.getByLabel("Account ID (12 digits) or account alias").fill("123456789012");
  await page.getByText("Remember this account").click();
  await page.getByLabel("IAM username").fill("demo");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/hosted-zones$/);
  await page.getByRole("button", { name: /demo @/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.getByLabel("IAM username").waitFor();
  check(
    (await page.getByLabel("Account ID (12 digits) or account alias").inputValue()) === "123456789012",
    "Remember this account pre-fills the account ID",
  );

  // --- Read-only IAM user: can browse, every write action is disabled
  {
    const isDisabled = (loc) =>
      loc.filter({ visible: true }).first().evaluate((el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true");
    const action = (name) => page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }));
    await page.getByLabel("IAM username").fill("viewer");
    await page.getByLabel("Password").fill("viewer1234");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/hosted-zones$/);
    await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().waitFor();
    check(await isDisabled(action("Create hosted zone")), "Read-only user: Create hosted zone is disabled");

    await page.getByRole("button", { name: /viewer @/ }).click();
    await page.getByText(/Role: Read-only/).filter({ visible: true }).first().waitFor();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await page.waitForURL(/\/account$/);
    await page.getByText("Coming soon").filter({ visible: true }).first().waitFor();
    check(true, "Account menu shows the role and its items open mocked pages");

    await page.goto(`${BASE}/hosted-zones?search=example.com`);
    await page.getByRole("link", { name: "example.com", exact: true }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/hosted-zones\/Z[^/?]+$/);
    await page.getByText("Hosted zone details").filter({ visible: true }).first().waitFor();
    const writes = ["Delete zone", "Edit hosted zone", "Create record", "Import zone file"];
    const states = await Promise.all(writes.map((n) => isDisabled(action(n))));
    const readsOk = !(await isDisabled(action("Test record"))) && !(await isDisabled(action("Export zone")));
    check(states.every(Boolean) && readsOk, `Read-only user: zone and record writes disabled, Test record/Export enabled (${states})`);
    await page.getByText("Hosted zone details").filter({ visible: true }).first().click();
    await page.getByText("arn:aws:route53:::hostedzone/").filter({ visible: true }).first().waitFor();
    check(true, "Hosted zone details show the hosted zone ARN");
    await shot("21-read-only");

    await page.getByRole("button", { name: /viewer @/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  }

  // --- Mobile viewport render
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Account ID (12 digits) or account alias").fill("123456789012");
  await page.getByLabel("IAM username").fill("demo");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/hosted-zones$/);
  await page.waitForTimeout(800);
  await shot("15-mobile");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, "No horizontal page overflow on mobile");

  const relevant = consoleErrors.filter((e) => !/401|Failed to load resource/.test(e));
  check(relevant.length === 0, `No unexpected console errors (${relevant.slice(0, 3).join(" | ")})`);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error("CRASH:", e.message);
  if (PAGE) await PAGE.screenshot({ path: `${SHOTS}/crash.png` }).catch(() => {});
  process.exit(2);
});
