Let’s introduce the concept of a “half-sector”. The basic idea is to let the user work with ceiling geometry separately from floor geometry. In all other DOOM editors (AFAIK), if you have ceiling deco that overlaps with floor deco, then you essentially have to work with sectors that represent the intersection of the two. So you can’t easily, for example, just move something on the floor independently of your ceiling patterns - you have to carefully readjust all the intersecting sectors and..probably most people just end up redoing it altogether.

A half sector (HS) can be of two types: “ceiling” or “floor”. A half sector consists of a polygon (with holes) and only properties related to the ceiling or floor, depending on its type. So a ceiling type only has upper textures on its linedefs, ceiling texture, and ceiling height, and respectively for floor sectors. Two HS’s of the same type should never overlap. HS’s should also never overlap or intersect normal geometry. However, a ceiling HS can intersect a floor HS.

- UX: Add a new “half sector” mode, with a dropdown for “floor vs. ceiling” mode. It works like draw-mode. HS’s can be selected in select mode. They should only expose properties relevant to their type.

- Architecture: HS’s are not directly exportable, so do not put them in ExportableMap. Instead, create a new interface called EditableMap, which extends ExportableMap, but also now holds a collection of HS’s.

- Upon WAD export:
  - Maintain a set of activeLines. For each HS’s linedef set, check if they intersect a linedef belonging to an HS of the opposite type. If yes, cut both linedefs and add the resulting lines to the active set. If not, just add it to the active set.
  - Then call fixSectors with activeLines with a temp copy of the map.
  - We need to modify fixSectors too: when creating new sectors, we need to check if it overlaps with any HS’s. if yes, it should adopt the HS’s properties, having it override any normal sector.
  - Export the WAD using the temp map.
