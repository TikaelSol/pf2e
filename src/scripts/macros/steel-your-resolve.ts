import { CharacterPF2e } from "@actor";
import { ActionDefaultOptions } from "@system/action-macros/index.ts";
import { localizer } from "@util";

export function steelYourResolve(options: ActionDefaultOptions): void {
    const localize = localizer("PF2E.Actions.SteelYourResolve");

    const actors = Array.isArray(options.actors) ? options.actors : [options.actors];
    const actor = actors[0];
    if (actors.length > 1 || !(actor instanceof CharacterPF2e)) {
        ui.notifications.error(localize("BadArgs"));
        return;
    }

    const toChat = (alias: string, content: string) => {
        ChatMessage.create({
            author: game.user.id,
            content,
            speaker: { alias },
        });
    };

    if (!game.pf2e.settings.variants.stamina) {
        ui.notifications.error(localize("StaminaNotEnabled"));
        return;
    }

    foundry.applications.api.DialogV2.confirm({
        window: { title: localize("Title") },
        content: localize("Content"),
        yes: {
            callback: () => {
                const sp = actor.system.attributes.hp.sp ?? { value: 0, max: 0 };
                const resolve = actor.system.resources.resolve ?? { value: 0, max: 0 };
                const spRatio = `${sp.value}/${sp.max}`;
                const recoverStamina = localize("RecoverStamina", { name: actor.name, ratio: spRatio });
                const noStamina = localize("NoStamina", { name: actor.name });
                if (resolve.value > 0) {
                    toChat(actor.name, recoverStamina);
                    const newSP = sp.value + Math.floor(sp.max / 2);
                    actor.update({
                        "system.attributes.hp.sp.value": Math.min(newSP, sp.max),
                        "system.resources.resolve.value": resolve.value - 1,
                    });
                } else {
                    toChat(actor.name, noStamina);
                }
            },
            default: true,
        },
    });
}
