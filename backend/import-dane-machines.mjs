/*
    import-dane-machines.mjs

    LANZAR Support Tickets — Ingest DANE Office Inventory into Firestore Assets
    
    Source: E:\00-Clients\DANE\Documentation\Inventory.xlsx
    Target: Firestore collection 'accounts/{accountId}/assets/{assetId}'
*/

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'node:fs';

const credentialPath = "C:\\Projects\\LANZAR\\firebase-credentials\\lanzar-95ae3-firebase-adminsdk-fbsvc-86e8ea5817.json";
const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const DRY_RUN = process.argv.includes('--dry-run');

async function importMachines() {
  console.log('====================================================');
  console.log('LANZAR ASSET INGESTION — DENTAL ASSOCIATES OF NEW ENGLAND');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (No writes)' : 'LIVE INGESTION'}`);
  console.log('====================================================\n');

  // 1. Locate DANE Account
  const accQuery = await db.collection('accounts')
    .where('shortName', '==', 'DANE')
    .limit(1)
    .get();

  if (accQuery.empty) {
    console.error('ERROR: DANE account not found in Firestore.');
    process.exit(1);
  }

  const accountDoc = accQuery.docs[0];
  const accountId = accountDoc.id;
  const accountRef = accountDoc.ref;
  console.log(`Found DANE Account: ${accountDoc.data().name} (${accountId})\n`);

  // 2. Read Extracted Machines JSON
  let rawData = fs.readFileSync('C:\\Projects\\lanzar\\tickets\\website\\backend\\dane_inventory_extracted.json', 'utf8');
  if (rawData.charCodeAt(0) === 0xFEFF) {
    rawData = rawData.slice(1);
  }
  const machines = JSON.parse(rawData);

  console.log(`Parsed ${machines.length} machine records from inventory.\n`);

  const batch = db.batch();
  let count = 0;

  for (const m of machines) {
    const rawAssetId = m["Asset ID"] ? m["Asset ID"].trim() : "";
    if (!rawAssetId) continue;

    // Generate clean, deterministic unique ID
    const stationSlug = (m["Station"] || m["Area"] || "").toLowerCase().replace(/[^a-z0-9]/g, '-');
    const assetSlug = rawAssetId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const docId = `asset-${assetSlug}-${stationSlug}-r${m["RowNumber"]}`;
    const assetRef = accountRef.collection('assets').doc(docId);

    const locationName = m["Location"] || "Boston";
    const locationId = locationName.toLowerCase().includes("waltham") ? "loc-wal" : "loc-bst";

    const payload = {
      assetId: docId,
      accountId: accountId,
      name: rawAssetId,
      hostname: rawAssetId,
      locationId: locationId,
      locationName: locationName.toLowerCase().includes("waltham") ? "Secondary Office (WAL)" : "Boston Main Office (BST)",
      area: m["Area"] || "",
      station: m["Station"] || "",
      deviceType: (m["Device Type"] || "Workstation").toLowerCase(),
      manufacturer: m["Manufacturer"] || "",
      model: m["Model"] || "",
      serviceTag: m["Service Tag"] || "",
      assignedUser: m["Assigned User / Role"] || "",
      network: m["Network"] || "",
      status: (m["Status"] || "Active").toLowerCase(),
      mapReference: m["Map Reference"] || "",
      verificationStatus: m["Verification"] || "Needs verification",
      notes: m["Notes"] || "",
      active: true,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (!DRY_RUN) {
      batch.set(assetRef, payload, { merge: true });
    }

    count++;
    console.log(`[${count}/${machines.length}] Staged: ${docId} | ${rawAssetId} | ${payload.locationName} | ${payload.area} - ${payload.station} | ${payload.serviceTag}`);
  }

  if (!DRY_RUN) {
    console.log(`\nWriting batch of ${count} assets to Firestore...`);
    await batch.commit();
    console.log(`✔ Successfully committed ${count} assets to accounts/${accountId}/assets/!`);
  } else {
    console.log(`\n✔ DRY RUN complete. ${count} assets would be written.`);
  }

  // Clean up temporary extracted json
  fs.unlinkSync('C:\\Projects\\lanzar\\tickets\\website\\backend\\dane_inventory_extracted.json');
}

importMachines().catch(err => {
  console.error('[IMPORT ERROR]', err);
  process.exit(1);
});
