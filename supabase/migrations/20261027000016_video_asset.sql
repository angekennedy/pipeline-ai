-- 0016 vidéo complète (MP4) : nouvel asset `video`, produit après les miniatures. Dans sa propre
-- migration : une valeur ajoutée à un enum n'est utilisable qu'une fois la transaction validée.
alter type public.asset_type add value if not exists 'video';
