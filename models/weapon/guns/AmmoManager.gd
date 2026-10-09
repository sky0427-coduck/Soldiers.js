# AmmoManager.gd (공통)
class_name AmmoManager
extends RefCounted

var max_ammo : int
var current_ammo : int

# 생성자: 총 파일에서 탄알 숫자를 넘겨받아 설정합니다.
func _init(p_max_ammo: int):
	max_ammo = p_max_ammo
	current_ammo = p_max_ammo # 처음엔 풀 충전

func consume_ammo() -> bool:
	if current_ammo > 0:
		current_ammo -= 1
		return true
	return false

func get_ammo_text() -> String:
	return "AMMO: " + str(current_ammo) + " / " + str(max_ammo)
