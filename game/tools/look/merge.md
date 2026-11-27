Consolidate blind witness reports in __WITNESSES__ against the packet in __PACKETS__ and
[the design intent](intent.md). This lane owns __SCOPE__. Read previous findings in __PRIOR__
and handoffs in __INBOX__.

Open the cited evidence. Mark an item agreed if multiple witnesses saw it and you can see it,
confirmed if one saw it and you can see it, or rejected with a short reason. Merge duplicates.
Keep the best still or frame reference, the player impact and what fixed looks like. Move requests
to change a goal under Goal questions for the owner.

Write the lane's ranked findings and Goal questions to __OUT__. Include rejected findings with
their reasons and end with `TOP: F<n>` or `TOP: none`. Write confirmed findings in the other
lane's scope to __HANDOFF__ with the same evidence, replacing that file.

The 3D scene lane owns `client/src/scene/three/`, Grimoire faces in `client/src/theme/grimoire/`,
and `client/src/layout/`. The HTML chrome lane owns `client/src/chrome/` and `client/src/app/`.
