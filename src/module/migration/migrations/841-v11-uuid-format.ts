import type { ActorSourcePF2e } from "@actor/data/index.ts";
import type { CompendiumDocumentType } from "@client/utils/_module.d.mts";
import type { ActorUUID, ItemUUID } from "@common/documents/_module.d.mts";
import type { ItemSourcePF2e } from "@item/base/data/index.ts";
import { itemIsOfType } from "@item/helpers.ts";
import { recursiveReplaceString } from "@util";
import * as R from "remeda";
import { MigrationBase } from "../base.ts";

/** Convert UUIDs to V11 format */
export class Migration841V11UUIDFormat extends MigrationBase {
    static override version = 0.841;

    #replaceUUID<T extends ActorUUID | ItemUUID>(uuid: T, documentType?: CompendiumDocumentType): T;
    #replaceUUID(uuid: string, documentType?: CompendiumDocumentType): string;
    #replaceUUID(uuid: unknown, explicitDocType?: CompendiumDocumentType): unknown {
        if (typeof uuid !== "string" || !uuid.startsWith("Compendium.")) {
            return uuid;
        }

        const documentType = ((): CompendiumDocumentType | null => {
            if (explicitDocType) return explicitDocType;
            if ("game" in globalThis) {
                const { collection } = fu.parseUuid(uuid) ?? {};
                return collection instanceof fd.collections.CompendiumCollection
                    ? (collection.metadata.type ?? null)
                    : null;
            }
            return null;
        })();
        if (!documentType) return uuid;

        const parts = uuid.split(/\.(?! )/);
        if (parts.length !== 4) return uuid;
        const [head, scope, pack, id] = parts;
        return `${head}.${scope}.${pack}.${documentType}.${id}`;
    }

    #replaceUUIDsInLinks<T>(text: T): T;
    #replaceUUIDsInLinks(text: unknown): unknown {
        if (typeof text !== "string") return text;

        return Array.from(text.matchAll(/(?<=@UUID\[)[^\]]+(?=\])/g)).reduce(
            (replaced, [link]) => replaced.replace(link, (s) => this.#replaceUUID(s)),
            text,
        );
    }

    override async updateActor(source: ActorSourcePF2e): Promise<void> {
        if (source._stats.compendiumSource) {
            source._stats.compendiumSource = this.#replaceUUID(source._stats.compendiumSource, "Actor");
        }

        if (source.type === "character") {
            if (R.isPlainObject(source.system.crafting) && Array.isArray(source.system.crafting.formulas)) {
                for (const formula of source.system.crafting.formulas) {
                    formula.uuid = this.#replaceUUID(formula.uuid, "Item");
                }
            }
        } else if (source.type === "npc") {
            const { details } = source.system;
            details.publicNotes &&= this.#replaceUUIDsInLinks(details.publicNotes);
            details.privateNotes &&= this.#replaceUUIDsInLinks(details.privateNotes);
        } else if (source.type === "hazard") {
            const { details } = source.system;
            details.reset &&= this.#replaceUUIDsInLinks(details.reset);
            details.description &&= this.#replaceUUIDsInLinks(details.description);
            details.routine &&= this.#replaceUUIDsInLinks(details.routine);
            details.disable &&= this.#replaceUUIDsInLinks(details.disable);
        }
    }

    override async updateItem(source: ItemSourcePF2e): Promise<void> {
        if (source._stats.compendiumSource) {
            source._stats.compendiumSource = this.#replaceUUID(source._stats.compendiumSource, "Item");
        }

        source.system.rules = source.system.rules.map((rule) => {
            if ("text" in rule && typeof rule.text === "string") {
                rule.text = this.#replaceUUIDsInLinks(rule.text);
            }
            return recursiveReplaceString(rule, (s) => this.#replaceUUID(s, "Item"));
        });

        if (itemIsOfType(source, "ancestry", "background", "class", "kit")) {
            const items: Record<string, { uuid: string; items?: Record<string, { uuid: string }> | null }> =
                source.system.items;
            for (const entry of Object.values(items)) {
                entry.uuid = this.#replaceUUID(entry.uuid, "Item");
                if (R.isPlainObject(entry.items)) {
                    for (const subentry of Object.values(entry.items)) {
                        subentry.uuid = this.#replaceUUID(subentry.uuid, "Item");
                    }
                }
            }
        } else if (source.type === "heritage") {
            if (source.system.ancestry?.uuid) {
                source.system.ancestry.uuid = this.#replaceUUID(source.system.ancestry.uuid, "Item");
            }
        } else if (source.type === "deity") {
            for (const [key, spell] of Object.entries(source.system.spells)) {
                source.system.spells[Number(key)] = this.#replaceUUID(spell);
            }
        }

        const { description } = source.system;
        description.value ??= "";
        description.value = this.#replaceUUIDsInLinks(description.value);
        description.value = description.value.replace(
            /Compendium\.pf2e\.journals\.(?!JournalEntry)/g,
            "Compendium.pf2e.journals.JournalEntry.",
        );
        description.gm &&= this.#replaceUUIDsInLinks(description.gm);
    }

    override async updateJournalEntry(source: foundry.documents.JournalEntrySource): Promise<void> {
        for (const page of source.pages) {
            page.text.content &&= this.#replaceUUIDsInLinks(page.text.content);
        }
    }
}
