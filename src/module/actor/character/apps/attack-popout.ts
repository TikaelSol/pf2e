import type { ApplicationV1HeaderButton } from "@client/appv1/api/application-v1.d.mts";
import type { ActorSheetOptions } from "@client/appv1/sheets/actor-sheet.d.mts";
import type { EffectTrait } from "@item/abstract-effect/types.ts";
import { ErrorPF2e, htmlClosest, htmlQuery } from "@util";
import type { CharacterStrike } from "../data.ts";
import type { CharacterPF2e } from "../document.ts";
import type { ElementalBlastConfig } from "../elemental-blast.ts";
import { CharacterSheetPF2e, type CharacterSheetData } from "../sheet.ts";

class AttackPopout<TActor extends CharacterPF2e> extends CharacterSheetPF2e<TActor> {
    type: "strike" | "blast" = "strike";
    #strikeItemId = "";
    #strikeSlug = "";
    #strike?: CharacterStrike;
    #elementTrait?: EffectTrait;
    #blasts: ElementalBlastConfig[] = [];

    override get template(): string {
        return "systems/pf2e/templates/actors/character/attack-popout.hbs";
    }

    override get id(): string {
        const id = super.id;
        return this.type === "strike"
            ? `${id}-strike-${this.#strikeItemId}-${this.#strikeSlug}`
            : `${id}-blast-${this.#elementTrait}`;
    }

    static override get defaultOptions(): ActorSheetOptions {
        const options = super.defaultOptions;
        return {
            ...options,
            classes: [...options.classes, "attack-popout"],
            submitOnChange: false,
            submitOnClose: false,
            width: 520,
            height: "auto",
            resizable: false,
        };
    }

    get label(): string | null {
        if (this.type === "blast") {
            return this.#blasts.at(0)?.label ?? null;
        }
        return this.#strike?.label ?? null;
    }

    constructor(object: TActor, options: AttackPopoutOptions) {
        super(object, options);

        if (!options.type) {
            throw ErrorPF2e('AttackPopout is missing mandatory "type" option.');
        }

        if (options.type === "blast") {
            if (!options.elementTrait) {
                throw ErrorPF2e('AttackPopout of type "blast" is missing mandatory "elementalTrait" option.');
            }
            this.#elementTrait = options.elementTrait;
        } else {
            if (!options.strikeSlug) {
                throw ErrorPF2e('AttackPopout of type "strike" is missing mandatory "strikeSlug" option.');
            }
            if (!options.strikeItemId) {
                throw ErrorPF2e('AttackPopout of type "strike" is missing mandatory "strikeItemId" option.');
            }
            this.#strikeSlug = options.strikeSlug;
            this.#strikeItemId = options.strikeItemId;
        }
        this.type = options.type;
    }

    override async getData(options: ActorSheetOptions): Promise<AttackPopoutData<TActor>> {
        const base = await super.getData(options);

        if (this.type === "blast") {
            base.elementalBlasts = this.#blasts = base.elementalBlasts.filter((b) => b.element === this.#elementTrait);
            base.data.actions = [];
            base.toggles.actions = base.toggles.actions?.filter((t) => t.domain === "elemental-blast") ?? [];
        } else {
            base.elementalBlasts = [];
            if (this.#strikeSlug && this.#strikeItemId) {
                this.#strike = base.data.actions.find(
                    (a) => a.item.id === this.#strikeItemId && a.slug === this.#strikeSlug,
                );
            }
        }

        return {
            ...base,
            strike: this.#strike,
            strikeIndex: base.data.actions.findIndex((a) => a === this.#strike),
            popoutType: this.type,
        };
    }

    override activateListeners($html: JQuery<HTMLElement>): void {
        super.activateListeners($html);
        const html = $html[0];

        // The label is only available after `getData` so the title has to be set here
        const { label } = this;
        if (label) {
            const title = htmlQuery(htmlClosest(html, "div.window-app"), "h4.window-title");
            if (title) {
                title.innerHTML = game.i18n.localize(label);
            }
        }
    }

    protected override _getHeaderButtons(): ApplicationV1HeaderButton[] {
        // Remove all buttons except the close button. `Close` is a core translation key
        return super._getHeaderButtons().filter((b) => b.label === "Close");
    }
}

interface BaseAttackPopoutOptions extends Partial<ActorSheetOptions> {
    type: string;
}

interface StrikePopoutOptions extends BaseAttackPopoutOptions {
    type: "strike";
    strikeSlug?: string;
    strikeItemId?: string;
}

interface BlastPopoutOptions extends BaseAttackPopoutOptions {
    type: "blast";
    elementTrait?: EffectTrait;
}

type AttackPopoutOptions = StrikePopoutOptions | BlastPopoutOptions;

interface AttackPopoutData<TActor extends CharacterPF2e> extends CharacterSheetData<TActor> {
    strike?: CharacterStrike;
    strikeIndex?: number;
    popoutType: AttackPopoutOptions["type"];
}

export { AttackPopout };
