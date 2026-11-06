import assert from "node:assert/strict";
import test from "node:test";
import { localizeDataset, parseIsoMetadata } from "../src/lib/metadata";
import type { Dataset } from "../src/types";

const sample = `<?xml version="1.0"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco">
  <gmd:fileIdentifier><gco:CharacterString>sample-record</gco:CharacterString></gmd:fileIdentifier>
  <gmd:contact><gmd:CI_ResponsibleParty>
    <gmd:individualName><gco:CharacterString>Staverl&#248;kk, Arnstein</gco:CharacterString></gmd:individualName>
    <gmd:organisationName><gco:CharacterString>Test Institute</gco:CharacterString></gmd:organisationName>
    <gmd:contactInfo><gmd:CI_Contact><gmd:address><gmd:CI_Address>
      <gmd:electronicMailAddress><gco:CharacterString>test@example.org</gco:CharacterString></gmd:electronicMailAddress>
    </gmd:CI_Address></gmd:address><gmd:onlineResource><gmd:CI_OnlineResource>
      <gmd:linkage><gmd:URL>https://contact.example.org</gmd:URL></gmd:linkage>
      <gmd:protocol><gco:CharacterString>WWW:LINK</gco:CharacterString></gmd:protocol>
    </gmd:CI_OnlineResource></gmd:onlineResource></gmd:CI_Contact></gmd:contactInfo>
    <gmd:role><gmd:CI_RoleCode>pointOfContact</gmd:CI_RoleCode></gmd:role>
  </gmd:CI_ResponsibleParty></gmd:contact>
  <gmd:referenceSystemInfo><gmd:MD_ReferenceSystem><gmd:referenceSystemIdentifier>
    <gmd:RS_Identifier><gmd:authority><gmd:CI_Citation><gmd:citedResponsibleParty>
      <gmd:CI_ResponsibleParty>
        <gmd:individualName><gco:CharacterString>EPSG registry</gco:CharacterString></gmd:individualName>
        <gmd:role><gmd:CI_RoleCode>originator</gmd:CI_RoleCode></gmd:role>
      </gmd:CI_ResponsibleParty>
      <gmd:onlineResource><gmd:CI_OnlineResource>
        <gmd:linkage><gmd:URL>https://epsg.example.org</gmd:URL></gmd:linkage>
      </gmd:CI_OnlineResource></gmd:onlineResource>
    </gmd:citedResponsibleParty></gmd:CI_Citation></gmd:authority></gmd:RS_Identifier>
  </gmd:referenceSystemIdentifier></gmd:MD_ReferenceSystem></gmd:referenceSystemInfo>
  <gmd:identificationInfo><gmd:MD_DataIdentification>
    <gmd:citation><gmd:CI_Citation><gmd:title><gco:CharacterString>Test dataset</gco:CharacterString></gmd:title></gmd:CI_Citation></gmd:citation>
    <gmd:status><gmd:MD_ProgressCode>completed</gmd:MD_ProgressCode></gmd:status>
    <gmd:descriptiveKeywords><gmd:MD_Keywords><gmd:keyword><gco:CharacterString>ecology</gco:CharacterString></gmd:keyword></gmd:MD_Keywords></gmd:descriptiveKeywords>
    <gmd:descriptiveKeywords><gmd:MD_Keywords>
      <gmd:keyword><gco:CharacterString>Occurrence</gco:CharacterString></gmd:keyword>
      <gmd:thesaurusName><gmd:CI_Citation><gmd:title>
        <gco:CharacterString>GBIF Dataset Type Vocabulary: https://example.org/types.xml</gco:CharacterString>
      </gmd:title></gmd:CI_Citation></gmd:thesaurusName>
    </gmd:MD_Keywords></gmd:descriptiveKeywords>
    <gmd:extent><gmd:EX_Extent><gmd:geographicElement><gmd:EX_GeographicBoundingBox>
      <gmd:westBoundLongitude><gco:Decimal>5</gco:Decimal></gmd:westBoundLongitude>
      <gmd:eastBoundLongitude><gco:Decimal>10</gco:Decimal></gmd:eastBoundLongitude>
      <gmd:southBoundLatitude><gco:Decimal>58</gco:Decimal></gmd:southBoundLatitude>
      <gmd:northBoundLatitude><gco:Decimal>62</gco:Decimal></gmd:northBoundLatitude>
    </gmd:EX_GeographicBoundingBox></gmd:geographicElement></gmd:EX_Extent></gmd:extent>
  </gmd:MD_DataIdentification></gmd:identificationInfo>
  <gmd:distributionInfo><gmd:MD_Distribution><gmd:transferOptions><gmd:MD_DigitalTransferOptions>
    <gmd:onLine><gmd:CI_OnlineResource>
      <gmd:linkage><gmd:URL>https://example.org/data.zip</gmd:URL></gmd:linkage>
      <gmd:name><gco:CharacterString>Dataset download</gco:CharacterString></gmd:name>
      <gmd:function><gmd:CI_OnLineFunctionCode>download</gmd:CI_OnLineFunctionCode></gmd:function>
    </gmd:CI_OnlineResource></gmd:onLine>
  </gmd:MD_DigitalTransferOptions></gmd:transferOptions></gmd:MD_Distribution></gmd:distributionInfo>
</gmd:MD_Metadata>`;

test("parses ISO metadata into detail-page data", () => {
  const metadata = parseIsoMetadata(sample);
  assert.ok(metadata.extent);
  assert.equal(metadata.extent.west, 5);
  assert.equal(metadata.extent.north, 62);
  assert.ok(metadata.metadata_sections.some((section) => section.title === "Dataset information"));
  assert.deepEqual(metadata.keyword_tags, ["ecology", "Occurrence"]);
  assert.deepEqual(
    metadata.keyword_groups.map((group) => [group.kind, group.values]),
    [
      ["keyword", ["ecology"]],
      ["theme", ["Occurrence"]],
    ],
  );
  assert.equal(metadata.contacts.length, 1);
  assert.equal(metadata.contacts[0].name, "Staverløkk, Arnstein");
  assert.equal(metadata.contacts[0].methods[0].href, "mailto:test@example.org");
  assert.equal(metadata.resources.length, 1);
  assert.equal(metadata.resources[0].href, "https://example.org/data.zip");
  const detailFields = metadata.metadata_sections.flatMap((section) => section.fields);
  assert.ok(detailFields.every((field) => !field.value.includes("; ")));
  assert.ok(detailFields.every((field) => field.value !== "originator"));
  assert.ok(detailFields.every((field) => field.value !== "Test dataset"));
  assert.ok(detailFields.every((field) => field.value !== "ecology"));
});

test("localizes labels without translating catalogue-supplied values", () => {
  const dataset: Dataset = {
    identifier: "sample-record",
    slug: "sample-record",
    title: "Dataset title",
    modified: "",
    abstract: "",
    preview: "",
    keyword_tags: [],
    keyword_groups: [],
    extent: null,
    metadata_sections: [
      { title: "Record details", fields: [{ label: "Character set", value: "utf8" }] },
    ],
    contacts: [
      {
        role: "Contact",
        name: "Test Person",
        organization: "Test Institute",
        position: "",
        methods: [{ label: "Email", value: "test@example.org", href: "mailto:test@example.org" }],
        address: [],
        hours: "",
        instructions: "",
      },
    ],
    resources: [
      {
        name: "Dataset download",
        description: "",
        url: "https://example.org/data.zip",
        href: "https://example.org/data.zip",
        action: "Download",
        function: "download",
        protocol: "",
        relation: "",
        format: "",
        format_version: "",
        channel: "",
      },
    ],
  };
  const translated = localizeDataset(dataset, "no", {
    preview_of: "Forhåndsvisning av {title}",
    map_extent: "Kart {title}",
  });
  assert.equal(translated.metadata_sections[0].title, "Postdetaljer");
  assert.equal(translated.metadata_sections[0].fields[0].label, "Tegnsett");
  assert.equal(translated.metadata_sections[0].fields[0].value, "utf8");
  assert.equal(translated.contacts[0].methods[0].label, "E-post");
  assert.equal(translated.resources[0].action, "Last ned");
});
