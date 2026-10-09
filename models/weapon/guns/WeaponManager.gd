extends Node

# Player/Camera3D 밑에 배치된 무기 노드들 (world.tscn: Player/Camera3D/M1911, Player/Camera3D/Bren2)
@onready var m1911 : Node3D = get_parent().get_node("M1911")
@onready var bren2 : Node3D = get_parent().get_node("Bren2")

# index 0 = 권총(M1911), index 1 = 돌격소총(Bren2)
var weapons : Array = []
var current_index : int = 0


func _ready() -> void:
	weapons = [m1911, bren2]
	_switch_weapon(0)   # 시작 무기: 권총(M1911)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("weapon_1"):
		_switch_weapon(0)
	elif event.is_action_pressed("weapon_2"):
		_switch_weapon(1)


func _switch_weapon(index: int) -> void:
	if index < 0 or index >= weapons.size():
		return
	if weapons[index] == null:
		return

	current_index = index
	for i in weapons.size():
		if weapons[i]:
			weapons[i].set_active(i == index)
