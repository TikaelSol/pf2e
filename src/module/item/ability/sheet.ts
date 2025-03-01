import type { AbilityItemPF2e } from "@item/ability/document.ts";
import { ItemSheetDataPF2e, ItemSheetOptions, ItemSheetPF2e } from "@item/base/sheet/sheet.ts";
import { getItemFromDragEvent } from "@module/sheet/helpers.ts";
import { ancestryTraits } from "@scripts/config/traits.ts";
import { ErrorPF2e } from "@util";
import * as R from "remeda";
import type { AbilitySystemSchema, SelfEffectReference } from "./data.ts";
import { activateActionSheetListeners, createSelfEffectSheetData, handleSelfEffectDrop } from "./helpers.ts";

// Gather traits to restrict to avoid trait selection noise in the selection
// We fetch at load time to avoid propagated homebrew traits
const originalAncestryTraits = R.keys(ancestryTraits);

class AbilitySheetPF2e extends ItemSheetPF2e<AbilityItemPF2e> {
    static override get defaultOptions(): ItemSheetOptions {
        return {
            ...super.defaultOptions,
            dragDrop: [{ dropSelector: ".tab[data-tab=details]" }],
            hasSidebar: true,
        };
    }

    protected override get validTraits(): Record<string, string> {
        return R.omit(this.item.constructor.validTraits, [
            ...originalAncestryTraits,
            "archetype",
            "cantrip",
            "class",
            "dedication",
            "focus",
            "general",
            "skill",
            "summoned",
        ] as const);
    }

    override async getData(options: Partial<ItemSheetOptions> = {}): Promise<ActionSheetData> {
        const sheetData = await super.getData(options);

        return {
            ...sheetData,
            fields: this.item.system.schema.fields,
            actionTypes: CONFIG.PF2E.actionTypes,
            actionsNumber: CONFIG.PF2E.actionsNumber,
            actionTraits: CONFIG.PF2E.actionTraits,
            frequencies: CONFIG.PF2E.frequencies,
            proficiencies: CONFIG.PF2E.proficiencyLevels,
            selfEffect: createSelfEffectSheetData(sheetData.data.selfEffect),
        };
    }

    /* -------------------------------------------- */
    /*  Event Listeners and Handlers                */
    /* -------------------------------------------- */

    override activateListeners($html: JQuery<HTMLElement>): void {
        super.activateListeners($html);
        if (!this.isEditable) return;

        const html = $html[0];
        activateActionSheetListeners(this.item, html);
    }

    override async _onDrop(event: DragEvent): Promise<void> {
        const item = await getItemFromDragEvent(event);
        if (!item) return;

        if (!(await handleSelfEffectDrop(this, item))) {
            throw ErrorPF2e("Invalid item drop");
        }
    }
}

interface ActionSheetData extends ItemSheetDataPF2e<AbilityItemPF2e> {
    fields: AbilitySystemSchema;
    actionTypes: typeof CONFIG.PF2E.actionTypes;
    actionsNumber: typeof CONFIG.PF2E.actionsNumber;
    actionTraits: typeof CONFIG.PF2E.actionTraits;
    frequencies: typeof CONFIG.PF2E.frequencies;
    proficiencies: typeof CONFIG.PF2E.proficiencyLevels;
    selfEffect: SelfEffectReference | null;
}

export { AbilitySheetPF2e };
